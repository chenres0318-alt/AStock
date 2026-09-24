import results from "@/data/buy-point-backtest.json";

export type PeriodKey = "2010-2015" | "2020-2026";

export type TradeRow = {
  code: string;
  name: string;
  signalDay: string;
  entryDay: string;
  exitDay: string;
  entryPx: number;
  exitPx: number;
  ret: number;
  reason: string;
};

export type MetricBlock = {
  endEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  median: number | null;
  payoff: number | null;
  expectancy: number | null;
};

export type StockBlock = MetricBlock & {
  code: string;
  name: string;
  first: string | null;
  last: string | null;
  bars: number;
  closed: TradeRow[];
};

export type PeriodBlock = {
  start: string;
  end: string;
  coverage: Array<{
    code: string;
    name: string;
    first: string | null;
    last: string | null;
    bars: number;
  }>;
  portfolio: MetricBlock;
  pooled: MetricBlock;
  stocks: StockBlock[];
};

export type BuyPointBacktestReport = {
  meta: {
    generatedAt: string;
    cash0: number;
    dataSource: string;
    universe: Array<{ code: string; name: string }>;
    assumptions: string[];
  };
  periods: Record<PeriodKey, PeriodBlock>;
};

export const PERIODS: PeriodKey[] = ["2010-2015", "2020-2026"];

export function loadBuyPointBacktest(): BuyPointBacktestReport {
  return results as BuyPointBacktestReport;
}
