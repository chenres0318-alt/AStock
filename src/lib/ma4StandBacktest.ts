import {
  captureSectorTrends,
  listMa4CrossStocks,
  standsOnMa4,
  type SectorMemberPath,
  type SectorTrendSegment,
} from "./sectorTrend.ts";
import type { KBar } from "./types.ts";

export const BACKTEST_STAKE = 20_000;
export const BACKTEST_CAPITAL = 100_000;
export const LOT = 100;

export type StockSeries = {
  code: string;
  name: string;
  bars: KBar[];
};

export type BacktestTrade = {
  code: string;
  name: string;
  standDays: number;
  entry: string;
  exit: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  cost: number;
  proceeds: number;
  pnl: number;
  returnPct: number;
  reason: "stock-ma4" | "index-ma4" | "box-end" | "period-end";
  boxStart: string;
  boxEnd: string;
};

export type EquityPoint = {
  time: string;
  equity: number;
};

export type EntryMode = "box-first-day" | "first-on-ma4";

export type BacktestResult = {
  label: string;
  start: string;
  end: string;
  entryMode: EntryMode;
  capital: number;
  finalEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  trades: BacktestTrade[];
  equity: EquityPoint[];
  boxes: number;
  skippedNoMa4: number;
  skippedNoStock: number;
  skippedNoCash: number;
  skippedOneDay: number;
};

function closeOnDay(bars: KBar[], time: string): number | null {
  const bar = bars.find((item) => item.time === time);
  return bar && bar.close > 0 ? bar.close : null;
}

function sliceThrough(bars: KBar[], time: string): KBar[] {
  const out: KBar[] = [];
  for (const bar of bars) {
    if (bar.time > time) break;
    out.push(bar);
  }
  return out;
}

export function lotsFor(stake: number, price: number): number {
  if (!(price > 0) || !(stake > 0)) return 0;
  return Math.floor(stake / price / LOT) * LOT;
}

function toPaths(stocks: StockSeries[]): SectorMemberPath[] {
  return stocks.map((stock) => {
    const closes = new Map<string, number>();
    for (const bar of stock.bars) closes.set(bar.time, bar.close);
    return { code: stock.code, name: stock.name, closes };
  });
}

function pickShortestStand(stocks: StockSeries[], entryTime: string) {
  const rows = listMa4CrossStocks(
    { start: entryTime, end: entryTime },
    stocks.map((stock) => ({
      code: stock.code,
      name: stock.name,
      bars: sliceThrough(stock.bars, entryTime),
      price: null,
    })),
  );
  return rows[0] ?? null;
}

/**
 * 半导体（或任意板块）MA4 最短站上选股回测。
 * 入场：红色趋势框第一天（或框内指数首次站上 MA4），且指数收盘站上 MA4，
 * 买成分股里连续站上 MA4 天数最短的一只，2 万、100 股一手。
 * 出场：个股收盘跌破 MA4、指数收盘跌破 MA4、趋势框结束、或区间最后一根。
 * 不计佣金印花税。成分股用给定名单（通常是当前成分，对历史有前视）。
 */
export function runMa4StandBacktest(input: {
  label: string;
  indexBars: KBar[];
  stocks: StockSeries[];
  periodStart: string;
  periodEnd: string;
  capital?: number;
  stake?: number;
  entryMode?: EntryMode;
  segments?: SectorTrendSegment[];
}): BacktestResult {
  const capital = input.capital ?? BACKTEST_CAPITAL;
  const stake = input.stake ?? BACKTEST_STAKE;
  const entryMode = input.entryMode ?? "box-first-day";

  const indexBars = input.indexBars.filter((bar) => bar.time <= input.periodEnd);
  const stocks = input.stocks.map((stock) => ({
    ...stock,
    bars: stock.bars.filter((bar) => bar.time <= input.periodEnd),
  }));
  const segments =
    input.segments ?? captureSectorTrends(indexBars, toPaths(stocks));
  const inPeriod = segments.filter(
    (segment) => segment.start >= input.periodStart && segment.start <= input.periodEnd,
  );

  type Position = {
    code: string;
    name: string;
    shares: number;
    entryPrice: number;
    entry: string;
    standDays: number;
    boxStart: string;
    boxEnd: string;
  };

  let cash = capital;
  const positions: Position[] = [];
  const trades: BacktestTrade[] = [];
  const equity: EquityPoint[] = [];
  let skippedNoMa4 = 0;
  let skippedNoStock = 0;
  let skippedNoCash = 0;
  let skippedOneDay = 0;
  const entered = new Set<string>();
  const missedMa4 = new Set<string>();

  const stockByCode = new Map(stocks.map((stock) => [stock.code, stock]));
  const indexByTime = new Map(indexBars.map((bar, index) => [bar.time, index]));

  function markToMarket(time: string): number {
    let value = cash;
    for (const pos of positions) {
      const series = stockByCode.get(pos.code);
      const price = series ? closeOnDay(series.bars, time) : null;
      value += pos.shares * (price ?? pos.entryPrice);
    }
    return value;
  }

  function closePosition(pos: Position, time: string, reason: BacktestTrade["reason"]) {
    const series = stockByCode.get(pos.code);
    const price = series ? closeOnDay(series.bars, time) : null;
    const exitPrice = price ?? pos.entryPrice;
    const cost = pos.shares * pos.entryPrice;
    const proceeds = pos.shares * exitPrice;
    cash += proceeds;
    trades.push({
      code: pos.code,
      name: pos.name,
      standDays: pos.standDays,
      entry: pos.entry,
      exit: time,
      entryPrice: pos.entryPrice,
      exitPrice,
      shares: pos.shares,
      cost,
      proceeds,
      pnl: proceeds - cost,
      returnPct: pos.entryPrice > 0 ? exitPrice / pos.entryPrice - 1 : 0,
      reason,
      boxStart: pos.boxStart,
      boxEnd: pos.boxEnd,
    });
  }

  function exitReason(pos: Position, time: string, indexOn: boolean): BacktestTrade["reason"] | null {
    const series = stockByCode.get(pos.code);
    if (!series) return "stock-ma4";
    const sliced = sliceThrough(series.bars, time);
    if (sliced.length < 4 || !standsOnMa4(sliced)) return "stock-ma4";
    if (!indexOn) return "index-ma4";
    if (time >= pos.boxEnd) return "box-end";
    return null;
  }

  function tryEnter(time: string, segment: SectorTrendSegment) {
    if (entered.has(segment.start)) return;
    if (segment.start === segment.end) {
      skippedOneDay += 1;
      entered.add(segment.start);
      return;
    }
    const idx = indexByTime.get(time);
    if (idx == null) return;
    if (!standsOnMa4(indexBars.slice(0, idx + 1))) {
      if (entryMode === "box-first-day") {
        skippedNoMa4 += 1;
        entered.add(segment.start);
      } else {
        missedMa4.add(segment.start);
      }
      return;
    }
    if (cash < stake) {
      skippedNoCash += 1;
      entered.add(segment.start);
      return;
    }
    const pick = pickShortestStand(stocks, time);
    if (!pick) {
      skippedNoStock += 1;
      entered.add(segment.start);
      return;
    }
    const series = stockByCode.get(pick.code);
    const price = series ? closeOnDay(series.bars, time) : null;
    const shares = price != null ? lotsFor(stake, price) : 0;
    if (price == null || shares <= 0) {
      skippedNoStock += 1;
      entered.add(segment.start);
      return;
    }
    cash -= shares * price;
    positions.push({
      code: pick.code,
      name: pick.name,
      shares,
      entryPrice: price,
      entry: time,
      standDays: pick.days,
      boxStart: segment.start,
      boxEnd: segment.end,
    });
    entered.add(segment.start);
    missedMa4.delete(segment.start);
  }

  for (const bar of indexBars) {
    if (bar.time < input.periodStart) continue;
    const idx = indexByTime.get(bar.time);
    if (idx == null) continue;
    const indexOn = standsOnMa4(indexBars.slice(0, idx + 1));

    const kept: Position[] = [];
    for (const pos of positions) {
      const reason = exitReason(pos, bar.time, indexOn);
      if (reason && pos.entry !== bar.time) {
        closePosition(pos, bar.time, reason);
      } else {
        kept.push(pos);
      }
    }
    positions.length = 0;
    positions.push(...kept);

    for (const segment of inPeriod) {
      const inBox = bar.time >= segment.start && bar.time <= segment.end;
      const isEntry =
        entryMode === "box-first-day" ? bar.time === segment.start : inBox;
      if (isEntry) tryEnter(bar.time, segment);
    }

    const after: Position[] = [];
    for (const pos of positions) {
      if (pos.entry === bar.time && bar.time >= pos.boxEnd) {
        closePosition(pos, bar.time, "box-end");
      } else {
        after.push(pos);
      }
    }
    positions.length = 0;
    positions.push(...after);

    equity.push({ time: bar.time, equity: Number(markToMarket(bar.time).toFixed(2)) });
  }

  const lastTime = equity.at(-1)?.time;
  if (lastTime) {
    for (const pos of [...positions]) closePosition(pos, lastTime, "period-end");
    positions.length = 0;
    if (equity.length) equity[equity.length - 1].equity = Number(cash.toFixed(2));
  }

  skippedNoMa4 += [...missedMa4].filter((start) => !entered.has(start)).length;

  let peak = capital;
  let maxDd = 0;
  for (const point of equity) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak > 0 ? (peak - point.equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const finalEquity = equity.at(-1)?.equity ?? capital;
  return {
    label: input.label,
    start: input.periodStart,
    end: input.periodEnd,
    entryMode,
    capital,
    finalEquity,
    returnPct: capital > 0 ? finalEquity / capital - 1 : 0,
    maxDrawdownPct: maxDd,
    trades,
    equity,
    boxes: inPeriod.length,
    skippedNoMa4,
    skippedNoStock,
    skippedNoCash,
    skippedOneDay,
  };
}
