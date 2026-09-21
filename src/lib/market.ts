import { cached } from "./cache";
import { DEFAULT_WATCHLIST, INDICES, SECTOR_ETFS, limitPercent, toTencentCode } from "./codes";
import { firstOk } from "./http";
import { getMarketStatus } from "./market-status";
import { fetchEastMoneySearch, fetchEastMoneySectors } from "./sources/eastmoney";
import { fetchSinaRank, fetchSinaSuggest } from "./sources/sina";
import { fetchTencentKline, fetchTencentQuotes, fetchTencentTrend } from "./sources/tencent";
import type {
  KBar,
  KlinePeriod,
  Quote,
  RankItem,
  SearchItem,
  SectorItem,
  TrendPoint,
} from "./types";

export async function getOverview(codes: string[]) {
  const wanted = Array.from(
    new Set([...INDICES.map((item) => item.code), ...codes.map(toTencentCode)]),
  );
  const quotes = await cached(`quotes:${wanted.sort().join(",")}`, 2500, () =>
    fetchTencentQuotes(wanted),
  );
  const map = new Map(quotes.map((item) => [item.code, item]));
  return {
    status: getMarketStatus(),
    indices: INDICES.map((item) => map.get(item.code)).filter(Boolean) as Quote[],
    quotes: codes
      .map(toTencentCode)
      .map((code) => map.get(code))
      .filter(Boolean) as Quote[],
  };
}

export async function getKline(code: string, period: KlinePeriod): Promise<KBar[]> {
  return cached(`kline:${toTencentCode(code)}:${period}`, 20_000, () =>
    fetchTencentKline(code, period),
  );
}

export async function getTrend(code: string): Promise<{
  points: TrendPoint[];
  preClose: number | null;
  tradeDate: string | null;
}> {
  return cached(`trend:${toTencentCode(code)}`, 4000, () => fetchTencentTrend(code));
}

export async function getSearch(keyword: string): Promise<SearchItem[]> {
  const q = keyword.trim();
  if (!q) return [];
  return cached(`search:${q}`, 60_000, () =>
    firstOk([
      () => fetchEastMoneySearch(q),
      () => fetchSinaSuggest(q),
    ]),
  );
}

export async function getRank(kind: "up" | "down" | "amount"): Promise<RankItem[]> {
  const sort = kind === "amount" ? "amount" : "changepercent";
  const asc = kind === "down" ? 1 : 0;
  return cached(`rank:${kind}`, 8000, () => fetchSinaRank(sort, asc, 40));
}

export async function getBoards(): Promise<{ limitUp: RankItem[]; limitDown: RankItem[] }> {
  return cached("boards", 10_000, async () => {
    const [up, down] = await Promise.all([
      fetchSinaRank("changepercent", 0, 80),
      fetchSinaRank("changepercent", 1, 80),
    ]);
    const nearLimit = (item: RankItem, direction: "up" | "down") => {
      if (item.pct == null) return false;
      const cap = limitPercent(item.code, item.name);
      return direction === "up" ? item.pct >= cap - 0.15 : item.pct <= -(cap - 0.15);
    };
    return {
      limitUp: up.filter((item) => nearLimit(item, "up")).slice(0, 30),
      limitDown: down.filter((item) => nearLimit(item, "down")).slice(0, 30),
    };
  });
}

export async function getSectors(): Promise<SectorItem[]> {
  return cached("sectors", 15_000, async () => {
    try {
      return await fetchEastMoneySectors(20);
    } catch {
      const quotes = await fetchTencentQuotes(SECTOR_ETFS.map((item) => item.code));
      const names = new Map(SECTOR_ETFS.map((item) => [item.code, item.name]));
      return quotes.map((quote) => ({
        code: quote.code,
        name: names.get(quote.code) || quote.name,
        pct: quote.pct,
        price: quote.price,
        leader: quote.name,
        leaderCode: quote.code,
        upCount: null,
        downCount: null,
        source: "etf" as const,
      }));
    }
  });
}

export function defaults() {
  return { indices: INDICES, watchlist: DEFAULT_WATCHLIST };
}
