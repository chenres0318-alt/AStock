import { marketOf, toTencentCode } from "../codes";
import { toNumber } from "../format";
import { fetchJson, fetchUtf } from "../http";
import type { BoardMember, KBar, SearchItem, SectorItem } from "../types";

type SuggestResponse = {
  QuotationCodeTable?: {
    Data?: Array<{
      Code?: string;
      Name?: string;
      QuoteID?: string;
      SecurityTypeName?: string;
      Classify?: string;
      MktNum?: string;
    }>;
  };
};

type ClistResponse = {
  data?: {
    total?: number;
    diff?: Array<Record<string, string | number | null>>;
  };
};

type KlineResponse = {
  data?: {
    name?: string;
    klines?: string[];
  };
};

const HOSTS = [
  "https://push2delay.eastmoney.com",
  "https://push2.eastmoney.com",
  "https://79.push2.eastmoney.com",
  "https://80.push2.eastmoney.com",
  "https://82.push2.eastmoney.com",
];

const HIS_KLINE = [
  "https://push2his.eastmoney.com/api/qt/stock/kline/get",
  "https://86.push2his.eastmoney.com/api/qt/stock/kline/get",
];

async function clist(query: string): Promise<ClistResponse> {
  let lastError: unknown;
  for (const host of HOSTS.slice(0, 2)) {
    try {
      const json = await fetchJson<ClistResponse>(`${host}${query}`, {
        referer: "https://quote.eastmoney.com/center/hsbk.html",
        timeoutMs: 7000,
      });
      if (json.data?.diff) return json;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("东财列表接口不可用");
}

export async function fetchEastMoneySearch(keyword: string): Promise<SearchItem[]> {
  const url =
    `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}` +
    `&type=14&token=D43BF458C8F90027E39A63ABB4900C42&count=12`;
  const json = await fetchJson<SuggestResponse>(url, { referer: "https://www.eastmoney.com/" });
  const rows = json.QuotationCodeTable?.Data ?? [];
  return rows
    .map((row) => {
      const quoteId = row.QuoteID || `${row.MktNum ?? "1"}.${row.Code ?? ""}`;
      const code = toTencentCode(quoteId);
      return {
        code,
        name: row.Name || row.Code || "",
        market: marketOf(code),
        typeName: row.SecurityTypeName || row.Classify || "A股",
      } satisfies SearchItem;
    })
    .filter((item) => item.name && /^\d{6}$/.test(item.code.slice(2)));
}

function mapSectorRows(rows: Array<Record<string, string | number | null>>): SectorItem[] {
  return rows.map((row) => ({
    code: String(row.f12 ?? ""),
    name: String(row.f14 ?? ""),
    price: toNumber(row.f2),
    pct: toNumber(row.f3),
    leader: row.f128 ? String(row.f128) : null,
    leaderCode: row.f140
      ? toTencentCode(`${row.f141 === 1 || row.f141 === "1" ? "1" : "0"}.${row.f140}`)
      : null,
    upCount: toNumber(row.f104),
    downCount: toNumber(row.f105),
    source: "bk" as const,
  }));
}

export async function fetchEastMoneySectors(limit = 24): Promise<SectorItem[]> {
  const json = await clist(
    `/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=m:90+t:2+f:!50&fields=f12,f14,f2,f3,f104,f105,f128,f140,f141`,
  );
  return mapSectorRows(json.data?.diff ?? []);
}

export async function fetchIndustryBoards(): Promise<SectorItem[]> {
  const collected: SectorItem[] = [];
  for (let pn = 1; pn <= 3; pn += 1) {
    try {
      const json = await clist(
        `/api/qt/clist/get?pn=${pn}&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3` +
          `&fs=m:90+t:2+f:!50&fields=f12,f14,f2,f3,f104,f105,f128,f140,f141`,
      );
      collected.push(...mapSectorRows(json.data?.diff ?? []));
    } catch {
      break;
    }
  }
  const seen = new Set<string>();
  const out: SectorItem[] = [];
  for (const item of collected) {
    if (!item.code || seen.has(item.code)) continue;
    seen.add(item.code);
    if (item.name.endsWith("Ⅲ") || item.name.endsWith("III")) continue;
    out.push(item);
  }
  if (!out.length) {
    return [];
  }
  return out;
}

export async function fetchBoardMembers(board: string, limit = 80): Promise<BoardMember[]> {
  const json = await clist(
    `/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f6` +
      `&fs=b:${board}+f:!50&fields=f12,f13,f14,f2,f3,f6,f8`,
  );
  return (json.data?.diff ?? [])
    .map((row) => {
      const raw = `${row.f13 === 1 || row.f13 === "1" ? "1" : "0"}.${row.f12 ?? ""}`;
      return {
        code: toTencentCode(raw),
        name: String(row.f14 ?? ""),
        price: toNumber(row.f2),
        pct: toNumber(row.f3),
        amount: toNumber(row.f6),
        turnover: toNumber(row.f8),
      } satisfies BoardMember;
    })
    .filter((item) => /^\d{6}$/.test(item.code.slice(2)));
}

function parseEmKlines(rows: string[] | undefined): KBar[] {
  if (!rows) return [];
  const bars: KBar[] = [];
  for (const row of rows) {
    const parts = String(row).split(",");
    if (parts.length < 6) continue;
    const open = toNumber(parts[1]);
    const close = toNumber(parts[2]);
    const high = toNumber(parts[3]);
    const low = toNumber(parts[4]);
    const volume = toNumber(parts[5]);
    if (!parts[0] || open == null || close == null || high == null || low == null) continue;
    bars.push({ time: parts[0], open, high, low, close, volume: volume ?? 0 });
  }
  return bars;
}

function parseMaybeJsonp(text: string): KlineResponse {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("j(")
    ? trimmed.replace(/^j\(/, "").replace(/\);?$/, "")
    : trimmed;
  return JSON.parse(jsonText) as KlineResponse;
}

export async function fetchEastMoneyKline(secid: string, count = 80): Promise<KBar[]> {
  const query =
    `secid=${secid}&ut=fa5fd1943c7b386f172d6893dbfba10b` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56` +
    `&klt=101&fqt=1&end=20500101&lmt=${count}`;
  let lastError: unknown;
  for (const base of HIS_KLINE) {
    for (const extra of ["", "&cb=j"]) {
      try {
        const text = await fetchUtf(`${base}?${query}${extra}`, {
          referer: "https://quote.eastmoney.com/",
          timeoutMs: 5000,
        });
        const json = parseMaybeJsonp(text);
        const bars = parseEmKlines(json.data?.klines);
        if (bars.length >= 40) return bars;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("板块K线不可用");
}
