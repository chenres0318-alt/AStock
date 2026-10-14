import { marketOf, toEastMoneySecId, toTencentCode } from "../codes";
import { toNumber } from "../format";
import { fetchJson, fetchUtf, UpstreamError } from "../http";
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

const CLIST_NUMBERS = [
  88, 91, 82, 80, 79, 47, 33, 17, 11, 7, 99, 4, 19, 21, 29, 38, 42, 56, 59, 63, 69, 71, 75, 94, 2, 13, 15, 23,
  27, 31, 36, 44, 52, 61, 66, 73, 77, 85, 93, 97,
];

const CLIST_HOSTS = [
  "https://push2delay.eastmoney.com",
  ...CLIST_NUMBERS.map((num) => `https://${num}.push2delay.eastmoney.com`),
  "https://push2.eastmoney.com",
  "https://push2his.eastmoney.com",
];

let preferredClistHost: string | null = null;

const HIS_KLINE = [
  "https://push2his.eastmoney.com/api/qt/stock/kline/get",
  "https://86.push2his.eastmoney.com/api/qt/stock/kline/get",
];

const MAIN_FLOW = [
  "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get",
  "https://86.push2his.eastmoney.com/api/qt/stock/fflow/daykline/get",
];

function firstFulfilled<T>(tasks: Array<() => Promise<T>>): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = tasks.length;
    let settled = false;
    let last: unknown;
    if (!pending) {
      reject(new UpstreamError("板块行情暂时取不到"));
      return;
    }
    for (const task of tasks) {
      task().then(
        (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        },
        (error) => {
          last = error;
          pending -= 1;
          if (!settled && pending === 0) {
            settled = true;
            reject(last instanceof Error ? last : new UpstreamError("板块行情暂时取不到"));
          }
        },
      );
    }
  });
}

async function clist(query: string): Promise<ClistResponse> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const hosts = preferredClistHost
      ? [preferredClistHost, ...CLIST_HOSTS.filter((host) => host !== preferredClistHost)]
      : CLIST_HOSTS;
    for (let index = 0; index < hosts.length; index += 6) {
      const batch = hosts.slice(index, index + 6);
      try {
        return await firstFulfilled(
          batch.map((host) => async () => {
            const json = await fetchJson<ClistResponse>(`${host}${query}`, {
              referer: "https://quote.eastmoney.com/center/hsbk.html",
              timeoutMs: 4000,
            });
            if (!json.data?.diff) throw new UpstreamError("板块列表为空");
            preferredClistHost = host;
            return json;
          }),
        );
      } catch {
        // 这一组节点不可用，换下一组。
      }
    }
  }
  throw new UpstreamError("板块行情暂时取不到");
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
  let total = Number.POSITIVE_INFINITY;
  // 按代码倒序分页。只取前 4 页会把代码靠后的行业丢掉，例如游戏Ⅱ。
  for (let pn = 1; pn <= 12 && collected.length < total; pn += 1) {
    const query =
      `/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12` +
      `&fs=m:90+t:2+f:!50&fields=f12,f14,f2,f3,f104,f105,f128,f140,f141`;
    let json: ClistResponse;
    try {
      json = await clist(query);
    } catch (error) {
      if (collected.length) break;
      throw error;
    }
    if (typeof json.data?.total === "number") total = json.data.total;
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
