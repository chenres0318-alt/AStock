import { listAllIndustryBoards } from "./boards";
import { cached } from "./cache";
import { DEFAULT_WATCHLIST, INDICES, SECTOR_ETFS, isForeignTencentCode, limitPercent, toTencentCode } from "./codes";
import { quotesInstrument } from "./quotesBoard";
import { fetchSinaFuturesKline } from "./sources/sinaFutures";
import { firstOk } from "./http";
import { getMarketStatus } from "./market-status";
import { fetchEastMoneyMainNet, fetchEastMoneySearch } from "./sources/eastmoney";
import { fetchSinaIndustries, fetchSinaRank, fetchSinaSuggest } from "./sources/sina";
import { pickPriorCloses } from "./intradayExtreme";
import { fetchTencentKline, fetchTencentMinuteKline, fetchTencentQuotes, fetchTencentTrend } from "./sources/tencent";
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
  const spec = quotesInstrument(code);
  if (spec?.source === "sina" && spec.sinaSymbol) {
    const count = period === "day" ? 400 : 180;
    return cached(`kline:sina:${spec.sinaSymbol}:${period}:${count}`, 60_000, () =>
      fetchSinaFuturesKline(spec.sinaSymbol!, period, count),
    );
  }
  const count = period === "day" ? 500 : 180;
  const tx = toTencentCode(code);
  return cached(`kline:${tx}:${period}:${count}:flow`, 20_000, async () => {
    const bars = await fetchTencentKline(code, period, count);
    if (period !== "day" || isForeignTencentCode(tx)) return bars;
    try {
      const flow = await fetchEastMoneyMainNet(code, count);
      return bars.map((bar) => ({ ...bar, mainNet: flow.get(bar.time) ?? null }));
    } catch {
      return bars;
    }
  });
}

export async function getTrend(code: string): Promise<{
  points: TrendPoint[];
  preClose: number | null;
  tradeDate: string | null;
  priorCloses: number[];
}> {
  const tx = toTencentCode(code);
  return cached(`trend:${tx}`, 4000, async () => {
    const [trend, minutes] = await Promise.all([
      fetchTencentTrend(code),
      cached(`mkline:${tx}`, 60_000, () => fetchTencentMinuteKline(code)).catch(() => []),
    ]);
    return { ...trend, priorCloses: pickPriorCloses(minutes, trend.tradeDate) };
  });
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
      const boards = await listAllIndustryBoards();
      if (boards.length) return boards.slice(0, 20);
    } catch {
      // 同花顺行业页读不到时，首页仍用证监会行业或行业 ETF
    }
    const sina = await fetchSinaIndustries()
      .then((rows) => rows.slice(0, 20))
      .catch(() => [] as SectorItem[]);
    if (sina.length) return sina;
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
  });
}

export function defaults() {
  return { indices: INDICES, watchlist: DEFAULT_WATCHLIST };
}
