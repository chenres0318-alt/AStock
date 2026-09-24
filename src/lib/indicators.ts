import type { KBar } from "./types";

export type MacdPoint = {
  dif: number;
  dea: number;
  hist: number;
};

export type ScreenFlags = {
  close: number;
  open: number;
  ma5: number;
  ma5Prev: number;
  dif: number;
  dea: number;
  hist: number;
  dayPct: number | null;
  amplitudePct: number | null;
  aboveMa5: boolean;
  ma5TurnUp: boolean;
  priorMa5Down: boolean;
  priorBelowMa5: boolean;
  redBar: boolean;
  volumeUp: boolean;
};

function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function maAt(values: number[], period: number, index: number): number | null {
  if (index < period - 1 || index >= values.length) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += values[i];
  return sum / period;
}

export function macdSeries(closes: number[]): Array<MacdPoint | null> {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const difVals: number[] = [];
  const map: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (ema12[i] == null || ema26[i] == null) continue;
    difVals.push(ema12[i]! - ema26[i]!);
    map.push(i);
  }
  const deaVals = emaSeries(difVals, 9);
  const out: Array<MacdPoint | null> = Array(closes.length).fill(null);
  for (let j = 0; j < difVals.length; j += 1) {
    if (deaVals[j] == null) continue;
    const dif = difVals[j];
    const dea = deaVals[j]!;
    out[map[j]] = { dif, dea, hist: 2 * (dif - dea) };
  }
  return out;
}

const MA5_LOOK = 8;

export function analyzeBarsAt(bars: KBar[], i: number, closes = bars.map((bar) => bar.close)): ScreenFlags | null {
  if (i < 19 || i >= bars.length) return null;
  const ma5 = maAt(closes, 5, i);
  const ma5Prev = maAt(closes, 5, i - 1);
  const ma5Prev2 = maAt(closes, 5, i - 2);
  const ma5Prev3 = maAt(closes, 5, i - 3);
  const ma5Prev4 = maAt(closes, 5, i - 4);
  const ma5Anchor = maAt(closes, 5, i - MA5_LOOK);
  if (
    ma5 == null ||
    ma5Prev == null ||
    ma5Prev2 == null ||
    ma5Prev3 == null ||
    ma5Prev4 == null ||
    ma5Anchor == null
  ) {
    return null;
  }

  let downSteps = 0;
  let slopeCount = 0;
  for (let j = i - MA5_LOOK + 1; j < i; j += 1) {
    const cur = maAt(closes, 5, j);
    const prev = maAt(closes, 5, j - 1);
    if (cur == null || prev == null) continue;
    slopeCount += 1;
    if (cur < prev) downSteps += 1;
  }
  const consecutiveDown = ma5Prev < ma5Prev2 && ma5Prev2 < ma5Prev3 && ma5Prev3 < ma5Prev4;
  const priorMa5Down =
    slopeCount >= 5 && downSteps >= Math.ceil(slopeCount * 0.7) && ma5Prev < ma5Anchor && consecutiveDown;
  const ma5TurnUp = ma5 > ma5Prev && ma5Prev <= ma5Prev2;

  let belowDays = 0;
  let belowCount = 0;
  for (let j = i - 8; j < i; j += 1) {
    if (j < 4) continue;
    const ma = maAt(closes, 5, j);
    if (ma == null) continue;
    belowCount += 1;
    if (closes[j] < ma) belowDays += 1;
  }
  const priorBelowMa5 = closes[i - 1] < ma5Prev && belowCount > 0 && belowDays >= Math.ceil(belowCount * 0.7);

  const prevClose = bars[i - 1].close;
  const dayPct = prevClose > 0 ? ((bars[i].close / prevClose - 1) * 100) : null;
  const amplitudePct = prevClose > 0 ? ((bars[i].high - bars[i].low) / prevClose) * 100 : null;
  const redBar = bars[i].close > bars[i].open;

  let volSum = 0;
  let volN = 0;
  for (let j = i - 5; j < i; j += 1) {
    if (j < 0) continue;
    volSum += bars[j].volume;
    volN += 1;
  }
  const volAvg = volN ? volSum / volN : 0;
  const volumeUp = volAvg > 0 && bars[i].volume >= volAvg * 1.2;

  return {
    close: bars[i].close,
    open: bars[i].open,
    ma5,
    ma5Prev,
    dif: 0,
    dea: 0,
    hist: 0,
    dayPct,
    amplitudePct,
    aboveMa5: closes[i] > ma5,
    ma5TurnUp,
    priorMa5Down,
    priorBelowMa5,
    redBar,
    volumeUp,
  };
}

export function analyzeBars(bars: KBar[]): ScreenFlags | null {
  if (bars.length < 20) return null;
  const flags = analyzeBarsAt(bars, bars.length - 1);
  if (!flags) return null;
  const macd = macdSeries(bars.map((bar) => bar.close));
  const cur = macd[bars.length - 1];
  return {
    ...flags,
    dif: cur?.dif ?? 0,
    dea: cur?.dea ?? 0,
    hist: cur?.hist ?? 0,
  };
}

export type BuyPoint = {
  time: string;
  close: number;
  turnover: number | null;
};

export function findBuyPoints(bars: KBar[]): BuyPoint[] {
  const points: BuyPoint[] = [];
  const closes = bars.map((bar) => bar.close);
  for (let i = 19; i < bars.length; i += 1) {
    const tech = analyzeBarsAt(bars, i, closes);
    if (!tech) continue;
    const turnover = bars[i].turnover ?? null;
    if (!passesScreen(tech, turnover)) continue;
    points.push({ time: bars[i].time, close: bars[i].close, turnover });
  }
  return points;
}

export function screenReasons(tech: ScreenFlags, turnover: number | null): string[] {
  const rows: string[] = [];
  if (tech.priorMa5Down) rows.push("五日线此前向下");
  if (tech.ma5TurnUp) rows.push("五日线拐头向上");
  if (tech.priorBelowMa5) rows.push("此前股价在五日线下方");
  if (tech.aboveMa5) rows.push("收盘站上五日线");
  if (tech.redBar && tech.volumeUp) rows.push("放量红柱");
  else if (tech.redBar) rows.push("红柱");
  else if (tech.volumeUp) rows.push("放量");
  if (turnover != null && turnover >= 2.5) rows.push("换手≥2.5%");
  if (tech.amplitudePct != null && tech.amplitudePct >= 2) rows.push("振幅≥2%");
  return rows;
}

export function passesScreen(tech: ScreenFlags, turnover: number | null): boolean {
  return (
    tech.ma5TurnUp &&
    tech.priorMa5Down &&
    tech.priorBelowMa5 &&
    tech.aboveMa5 &&
    tech.redBar &&
    tech.volumeUp &&
    tech.amplitudePct != null &&
    tech.amplitudePct >= 2 &&
    turnover != null &&
    turnover >= 2.5
  );
}
