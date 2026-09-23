export type MacdPoint = {
  dif: number;
  dea: number;
  hist: number;
};

export type TechFlags = {
  close: number;
  ma5: number;
  ma5Prev: number;
  ma5Prev2: number;
  dif: number;
  dea: number;
  hist: number;
  histPrev: number;
  histPrev2: number;
  aboveMa5: boolean;
  firstStandMa5: boolean;
  daysAboveMa5: number;
  goldenCross: boolean;
  deathCross: boolean;
  nearZeroAxis: boolean;
  threeDayPct: number | null;
};

export const FIRST_STAND_MAX_DAYS = 3;
export const FIRST_STAND_MIN_BELOW = 3;
export const STOCK_THREE_DAY_CAP = 5;
export const MACD_NEAR_ZERO_PCT = 2;

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

function consecutiveMa5(
  closes: number[],
  index: number,
  above: boolean,
): number {
  let n = 0;
  for (let k = index; k >= 4; k -= 1) {
    const ma = maAt(closes, 5, k);
    if (ma == null) break;
    const isAbove = closes[k] > ma;
    if (above ? !isAbove : isAbove) break;
    n += 1;
  }
  return n;
}

export function analyzeCloses(closes: number[]): TechFlags | null {
  if (closes.length < 40) return null;
  const i = closes.length - 1;
  const ma5 = maAt(closes, 5, i);
  const ma5Prev = maAt(closes, 5, i - 1);
  const ma5Prev2 = maAt(closes, 5, i - 2);
  const macd = macdSeries(closes);
  const cur = macd[i];
  const prev = macd[i - 1];
  const prev2 = macd[i - 2];
  if (ma5 == null || ma5Prev == null || ma5Prev2 == null || !cur || !prev || !prev2) return null;

  const lineMag = Math.max(Math.abs(cur.dif), Math.abs(cur.dea));
  const nearZeroAxis = closes[i] > 0 && (lineMag / closes[i]) * 100 <= MACD_NEAR_ZERO_PCT;

  const daysAboveMa5 = consecutiveMa5(closes, i, true);
  const daysBelowBefore = daysAboveMa5 > 0 ? consecutiveMa5(closes, i - daysAboveMa5, false) : 0;
  const firstStandMa5 =
    daysAboveMa5 >= 1 &&
    daysAboveMa5 <= FIRST_STAND_MAX_DAYS &&
    daysBelowBefore >= FIRST_STAND_MIN_BELOW;

  const threeDayPct =
    closes.length >= 4 && closes[i - 3] > 0 ? (closes[i] / closes[i - 3] - 1) * 100 : null;

  return {
    close: closes[i],
    ma5,
    ma5Prev,
    ma5Prev2,
    dif: cur.dif,
    dea: cur.dea,
    hist: cur.hist,
    histPrev: prev.hist,
    histPrev2: prev2.hist,
    aboveMa5: closes[i] > ma5,
    firstStandMa5,
    daysAboveMa5,
    goldenCross: cur.dif > cur.dea,
    deathCross: cur.dif < cur.dea,
    nearZeroAxis,
    threeDayPct,
  };
}

export function passesBoardTech(tech: TechFlags): boolean {
  return tech.firstStandMa5 && tech.nearZeroAxis && (tech.goldenCross || tech.deathCross);
}

export function passesStockTech(tech: TechFlags): boolean {
  if (!passesBoardTech(tech)) return false;
  if (tech.threeDayPct == null || tech.threeDayPct > STOCK_THREE_DAY_CAP) return false;
  return true;
}
