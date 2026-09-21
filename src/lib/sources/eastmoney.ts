import { marketOf, toTencentCode } from "../codes";
import { toNumber } from "../format";
import { fetchJson } from "../http";
import type { SearchItem, SectorItem } from "../types";

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
    diff?: Array<Record<string, string | number | null>>;
  };
};

const HOSTS = [
  "https://push2.eastmoney.com",
  "https://push2delay.eastmoney.com",
  "https://79.push2.eastmoney.com",
  "https://80.push2.eastmoney.com",
  "https://82.push2.eastmoney.com",
];

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

export async function fetchEastMoneySectors(limit = 24): Promise<SectorItem[]> {
  const query =
    `/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f3` +
    `&fs=m:90+t:2+f:!50&fields=f12,f14,f2,f3,f104,f105,f128,f140,f141`;

  let lastError: unknown;
  for (const host of HOSTS) {
    try {
      const json = await fetchJson<ClistResponse>(`${host}${query}`, {
        referer: "https://quote.eastmoney.com/center/hsbk.html",
        timeoutMs: 6000,
      });
      const rows = json.data?.diff ?? [];
      if (!rows.length) continue;
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
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("板块接口不可用");
}
