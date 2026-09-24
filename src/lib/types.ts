export type Market = "SH" | "SZ" | "BJ";

export type WatchItem = {
  code: string;
  name: string;
};

export type OrderLevel = {
  price: number | null;
  volume: number | null;
};

export type Quote = {
  code: string;
  name: string;
  market: Market;
  price: number | null;
  preClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  pct: number | null;
  volume: number | null;
  amount: number | null;
  turnover: number | null;
  amplitude: number | null;
  pe: number | null;
  pb: number | null;
  floatMv: number | null;
  totalMv: number | null;
  limitUp: number | null;
  limitDown: number | null;
  inner: number | null;
  outer: number | null;
  bids: OrderLevel[];
  asks: OrderLevel[];
  time: string | null;
  halted: boolean;
};

export type KBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number | null;
};

export type TrendPoint = {
  time: string;
  timestamp: number;
  price: number;
  avg: number | null;
  volume: number;
};

export type SearchItem = {
  code: string;
  name: string;
  market: Market;
  typeName: string;
};

export type RankItem = {
  code: string;
  name: string;
  price: number | null;
  change: number | null;
  pct: number | null;
  volume: number | null;
  amount: number | null;
  turnover: number | null;
};

export type SectorItem = {
  code: string;
  name: string;
  pct: number | null;
  price: number | null;
  leader: string | null;
  leaderCode: string | null;
  upCount: number | null;
  downCount: number | null;
  source: "bk" | "etf" | "sina";
};

export type BoardMember = {
  code: string;
  name: string;
  price: number | null;
  pct: number | null;
  amount: number | null;
  turnover: number | null;
};

export type MarketPhase =
  | "closed"
  | "pre"
  | "auction"
  | "trading"
  | "lunch"
  | "post";

export type MarketStatus = {
  phase: MarketPhase;
  label: string;
  trading: boolean;
  weekday: boolean;
  serverTime: string;
};

export type KlinePeriod = "day" | "week" | "month";

export type ScreenerHit = {
  code: string;
  name: string;
  price: number;
  pct: number | null;
  turnover: number | null;
  amplitudePct: number | null;
  ma5: number;
  dif: number;
  dea: number;
  hist: number;
  reasons: string[];
};
