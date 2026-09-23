import results from "@/data/backtest.json";

export type PeriodKey = "2010-2015" | "2020-2026";

export type PeriodStats = {
  endEquity: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  payoff: number | null;
  winRate: number | null;
  trades: number;
  calmar: number;
  bestMonth: number | null;
  worstMonth: number | null;
  medianMonth: number | null;
  monthsGe30: number;
  monthCount: number;
};

export type StrategyResult = {
  id: string;
  name: string;
  family: string;
  summary: string;
  rules: string[];
  periods: Record<PeriodKey, PeriodStats>;
  score: {
    minCalmar: number;
    meanCalmar: number;
    meanPayoff: number;
    meanCagr: number;
    meanDrawdown: number;
  };
};

export type BacktestReport = {
  meta: {
    cash0: number;
    generatedAt: string;
    dataSource: string;
    universeSize: number;
    index: { code: string; name: string; bars: number };
    assumptions: string[];
  };
  periods: Record<PeriodKey, { start: string; end: string }>;
  strategies: StrategyResult[];
  winner: {
    id: string;
    name: string;
    reason: string;
    bestActive: { id: string; name: string };
    bothPeriodsPositive: Array<{ id: string; name: string }>;
    byMetric: {
      payoff: { id: string; name: string };
      cagr: { id: string; name: string };
      drawdown: { id: string; name: string };
    };
  };
};

export const PERIODS: PeriodKey[] = ["2010-2015", "2020-2026"];

export function loadBacktest(): BacktestReport {
  return results as BacktestReport;
}

export function rankedStrategies(report: BacktestReport): StrategyResult[] {
  return [...report.strategies].sort((a, b) => {
    if (b.score.minCalmar !== a.score.minCalmar) return b.score.minCalmar - a.score.minCalmar;
    if (b.score.meanPayoff !== a.score.meanPayoff) return b.score.meanPayoff - a.score.meanPayoff;
    return b.score.meanCagr - a.score.meanCagr;
  });
}
