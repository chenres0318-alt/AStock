import { marketOf, toEastMoneySecId, toTencentCode } from "../codes";
import { toNumber } from "../format";
import { fetchHttp1, fetchHttps1, fetchJson, UpstreamError } from "../http";
import type { BoardMember, KBar, RankItem, SearchItem, SectorItem } from "../types";

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

const MAIN_FLOW = [
  "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get",
  "https://86.push2his.eastmoney.com/api/qt/stock/fflow/daykline/get",
];

let preferredListOrigin: string | null = null;
let preferredHisOrigin: string | null = null;

function rotatedNumbers(): number[] {
  const numbers = Array.from({ length: 99 }, (_, index) => index + 1);
  const shift = Math.floor(Math.random() * numbers.length);
  return numbers.slice(shift).concat(numbers.slice(0, shift));
}

function remember(preferred: string | null, origins: string[]): string[] {
  if (!preferred) return origins;
  return [preferred, ...origins.filter((origin) => origin !== preferred)];
}

async function readOrigin(origin: string, path: string, referer: string): Promise<string> {
  const url = `${origin}${path}`;
  return origin.startsWith("https:")
    ? fetchHttps1(url, 2800, referer)
    : fetchHttp1(url, 2800, referer);
}

async function firstOrigin<T>(origins: string[], read: (origin: string) => Promise<T | null>): Promise<{ origin: string; value: T } | null> {
  for (let index = 0; index < origins.length; index += 6) {
    const batch = origins.slice(index, index + 6);
    const found = await new Promise<{ origin: string; value: T } | null>((resolve) => {
      let pending = batch.length;
      let settled = false;
      if (!pending) {
        resolve(null);
        return;
      }
      for (const origin of batch) {
        read(origin).then(
          (value) => {
            if (settled) return;
            if (value) {
              settled = true;
              resolve({ origin, value });
              return;
            }
            pending -= 1;
            if (pending === 0) resolve(null);
          },
          () => {
            if (settled) return;
            pending -= 1;
            if (pending === 0) resolve(null);
          },
        );
      }
    });
    if (found) return found;
  }
  return null;
}

function listOrigins(): string[] {
  const numbers = rotatedNumbers();
  return remember(preferredListOrigin, [
    "https://push2delay.eastmoney.com",
    "https://push2.eastmoney.com",
    "http://push2delay.eastmoney.com",
    "http://push2.eastmoney.com",
    ...numbers.map((num) => `http://${num}.push2delay.eastmoney.com`),
    ...numbers.map((num) => `http://${num}.push2.eastmoney.com`),
  ]);
}

async function clist(query: string): Promise<ClistResponse> {
  const found = await firstOrigin(listOrigins(), async (origin) => {
    const text = await readOrigin(origin, query, "https://quote.eastmoney.com/center/hsbk.html");
    const json = JSON.parse(text) as ClistResponse;
    return json.data?.diff ? json : null;
  });
  if (!found) throw new UpstreamError("板块名单暂时取不到");
  preferredListOrigin = found.origin;
  return found.value;
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

export async function fetchAllIndustryBoards(): Promise<SectorItem[]> {
  const collected: SectorItem[] = [];
  for (let pn = 1; pn <= 4; pn += 1) {
    const json = await clist(
      `/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12` +
        `&fs=m:90+t:2+f:!50&fields=f12,f14,f2,f3,f104,f105,f128,f140,f141`,
    );
    const rows = mapSectorRows(json.data?.diff ?? []);
    if (!rows.length) break;
    collected.push(...rows);
    if (rows.length < 100) break;
  }
  const seen = new Set<string>();
  const out: SectorItem[] = [];
  for (const item of collected) {
    if (!item.code || seen.has(item.code)) continue;
    seen.add(item.code);
    if (item.name.endsWith("Ⅲ") || item.name.endsWith("III")) continue;
    out.push(item);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return out;
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

export async function fetchEastMoneyAmountRank(limit = 360): Promise<RankItem[]> {
  const pz = 100;
  const collected: RankItem[] = [];
  const seen = new Set<string>();
  for (let pn = 1; pn <= Math.ceil(limit / pz); pn += 1) {
    const json = await clist(
      `/api/qt/clist/get?pn=${pn}&pz=${pz}&po=1&np=1&fltt=2&invt=2&fid=f6` +
        `&fs=m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2` +
        `&fields=f12,f13,f14,f2,f3,f6,f8`,
    );
    const rows = json.data?.diff ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      const raw = `${row.f13 === 1 || row.f13 === "1" ? "1" : "0"}.${row.f12 ?? ""}`;
      const code = toTencentCode(raw);
      if (!/^\d{6}$/.test(code.slice(2)) || seen.has(code)) continue;
      seen.add(code);
      collected.push({
        code,
        name: String(row.f14 ?? ""),
        price: toNumber(row.f2),
        change: null,
        pct: toNumber(row.f3),
        volume: null,
        amount: toNumber(row.f6),
        turnover: toNumber(row.f8),
      });
      if (collected.length >= limit) return collected;
    }
    if (rows.length < pz) break;
  }
  return collected;
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

/** 日线主力净流入，按日期。正数为净流入。 */
export async function fetchEastMoneyMainNet(code: string, limit = 500): Promise<Map<string, number>> {
  const secid = toEastMoneySecId(code);
  const query =
    `lmt=${limit}&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52`;
  let lastError: unknown;
  for (const base of MAIN_FLOW) {
    try {
      const json = await fetchJson<{ data?: { klines?: string[] } }>(`${base}?${query}`, {
        referer: "https://quote.eastmoney.com/",
        timeoutMs: 8000,
      });
      const rows = json.data?.klines ?? [];
      const map = new Map<string, number>();
      for (const row of rows) {
        const [date, net] = String(row).split(",");
        const value = toNumber(net);
        if (date && value != null) map.set(date, value);
      }
      if (map.size) return map;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("主力资金不可用");
}

type BoardSeries = { name: string | null; bars: KBar[] };

function historyOrigins(): string[] {
  const numbers = rotatedNumbers();
  return remember(preferredHisOrigin, [
    "https://push2his.eastmoney.com",
    "https://86.push2his.eastmoney.com",
    "http://push2his.eastmoney.com",
    "http://86.push2his.eastmoney.com",
    ...numbers.map((num) => `http://${num}.push2his.eastmoney.com`),
    ...numbers.map((num) => `https://${num}.push2his.eastmoney.com`),
  ]);
}

/** 板块日线。默认历史节点空回复时，改问东财编号节点，并记住能返回数据的那一台。 */
export async function fetchEastMoneyBoardSeries(secid: string, count = 80): Promise<BoardSeries> {
  const query =
    `/api/qt/stock/kline/get?secid=${secid}&ut=fa5fd1943c7b386f172d6893dbfba10b` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56` +
    `&klt=101&fqt=1&end=20500101&lmt=${count}`;
  const need = Math.min(40, count);
  const found = await firstOrigin(historyOrigins(), async (origin) => {
    const json = parseMaybeJsonp(await readOrigin(origin, query, "https://quote.eastmoney.com/"));
    const bars = parseEmKlines(json.data?.klines);
    if (bars.length < need) return null;
    return { name: json.data?.name?.trim() || null, bars: bars.slice(-count) } satisfies BoardSeries;
  });
  if (!found) throw new UpstreamError("板块K线暂时取不到");
  preferredHisOrigin = found.origin;
  return found.value;
}

export async function fetchEastMoneyKline(secid: string, count = 80): Promise<KBar[]> {
  const series = await fetchEastMoneyBoardSeries(secid, count);
  return series.bars;
}
