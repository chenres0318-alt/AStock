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
  ma20: number | null;
  dif: number;
  dea: number;
  hist: number;
  dayPct: number | null;
  amplitudePct: number | null;
  aboveMa5: boolean;
  firstStandMa5: boolean;
  macdBull: boolean;
  macdBearWeak: boolean;
  belowMa20: boolean;
  strongReclaim: boolean;
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

const FIRST_STAND_LOOK = 5;
/** 20 日线下方的空头减弱，只保留大阳 / 大振幅反包，避免下跌中继假买点。 */
const STRONG_RECLAIM_DAY_PCT = 5;
const STRONG_RECLAIM_AMP_PCT = 8;

export function analyzeBarsAt(
  bars: KBar[],
  i: number,
  closes = bars.map((bar) => bar.close),
  macd = macdSeries(closes),
): ScreenFlags | null {
  if (i < FIRST_STAND_LOOK + 3 || i >= bars.length) return null;
  const ma5 = maAt(closes, 5, i);
  const ma5Prev = maAt(closes, 5, i - 1);
  if (ma5 == null || ma5Prev == null) return null;

  const aboveMa5 = closes[i] > ma5;
  let firstStandMa5 = aboveMa5;
  if (firstStandMa5) {
    for (let j = i - (FIRST_STAND_LOOK - 1); j < i; j += 1) {
      const ma = maAt(closes, 5, j);
      if (ma == null || closes[j] > ma) {
        firstStandMa5 = false;
        break;
      }
    }
  }

  const cur = macd[i];
  const prev = macd[i - 1];
  const macdBull = Boolean(cur && cur.dea > 0 && cur.dif + 1e-8 >= cur.dea);
  const macdBearWeak = Boolean(
    cur &&
      prev &&
      !(cur.dea > 0 && cur.dif + 1e-8 >= cur.dea) &&
      cur.hist > prev.hist &&
      (cur.hist < 0 || cur.dea <= 0 || cur.dif <= 0),
  );

  const prevClose = bars[i - 1].close;
  const dayPct = prevClose > 0 ? ((bars[i].close / prevClose - 1) * 100) : null;
  const amplitudePct = prevClose > 0 ? ((bars[i].high - bars[i].low) / prevClose) * 100 : null;
  const ma20 = maAt(closes, 20, i);
  const belowMa20 = ma20 != null && closes[i] < ma20;
  const strongReclaim = Boolean(
    closes[i] >= bars[i].open &&
      ((dayPct != null && dayPct >= STRONG_RECLAIM_DAY_PCT) ||
        (amplitudePct != null && amplitudePct >= STRONG_RECLAIM_AMP_PCT)),
  );

  return {
    close: bars[i].close,
    open: bars[i].open,
    ma5,
    ma5Prev,
    ma20,
    dif: cur?.dif ?? 0,
    dea: cur?.dea ?? 0,
    hist: cur?.hist ?? 0,
    dayPct,
    amplitudePct,
    aboveMa5,
    firstStandMa5,
    macdBull,
    macdBearWeak,
    belowMa20,
    strongReclaim,
  };
}

export function analyzeBars(bars: KBar[]): ScreenFlags | null {
  if (bars.length < 40) return null;
  const closes = bars.map((bar) => bar.close);
  return analyzeBarsAt(bars, bars.length - 1, closes, macdSeries(closes));
}

export type BuyPoint = {
  time: string;
  close: number;
};

export type TdMark<T = string> = {
  time: T;
  count: number;
  side: "up" | "down";
};

/** TD Setup：收盘价与 4 根之前比较，同向连续计数，满 9 后若仍同向则从 1 重新计。 */
export function tdSequential<T>(points: Array<{ time: T; close: number }>): Array<TdMark<T>> {
  const marks: Array<TdMark<T>> = [];
  let up = 0;
  let down = 0;
  for (let i = 4; i < points.length; i += 1) {
    const close = points[i].close;
    const ref = points[i - 4].close;
    if (close > ref) {
      down = 0;
      up = up >= 9 ? 1 : up + 1;
      marks.push({ time: points[i].time, count: up, side: "up" });
    } else if (close < ref) {
      up = 0;
      down = down >= 9 ? 1 : down + 1;
      marks.push({ time: points[i].time, count: down, side: "down" });
    } else {
      up = 0;
      down = 0;
    }
  }
  return marks;
}

export function findBuyPoints(bars: KBar[]): BuyPoint[] {
  const points: BuyPoint[] = [];
  if (bars.length < 40) return points;
  const closes = bars.map((bar) => bar.close);
  const macd = macdSeries(closes);
  for (let i = 33; i < bars.length; i += 1) {
    const tech = analyzeBarsAt(bars, i, closes, macd);
    if (!tech || !passesScreen(tech)) continue;
    points.push({ time: bars[i].time, close: bars[i].close });
  }
  return points;
}

export function screenReasons(tech: ScreenFlags): string[] {
  const rows: string[] = [];
  if (tech.firstStandMa5) rows.push("近5日首次站上五日线");
  if (tech.macdBull) rows.push("MACD多头排列");
  else if (tech.macdBearWeak) rows.push("MACD空头减弱");
  if (tech.macdBearWeak && tech.belowMa20 && tech.strongReclaim) rows.push("大阳反包");
  return rows;
}

export function passesScreen(tech: ScreenFlags): boolean {
  if (!tech.firstStandMa5) return false;
  if (tech.macdBull) return true;
  if (!tech.macdBearWeak) return false;
  // 20 日线下方的空头减弱，多数是下跌中继；只留下大阳 / 大振幅反包。
  if (tech.belowMa20 && !tech.strongReclaim) return false;
  return true;
}
