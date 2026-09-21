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
  ma5TurnUp: boolean;
  deathCross: boolean;
  greenShrinking: boolean;
  nearZeroAxis: boolean;
  threeDayPct: number | null;
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

export function analyzeCloses(closes: number[]): TechFlags | null {
  if (closes.length < 40) return null;
  const i = closes.length - 1;
  const ma5 = maAt(closes, 5, i);
  const ma5Prev = maAt(closes, 5, i - 1);
  const ma5Prev2 = maAt(closes, 5, i - 2);
  const ma5Prev3 = maAt(closes, 5, i - 3);
  const macd = macdSeries(closes);
  const cur = macd[i];
  const prev = macd[i - 1];
  const prev2 = macd[i - 2];
  if (ma5 == null || ma5Prev == null || ma5Prev2 == null || ma5Prev3 == null || !cur || !prev || !prev2) return null;

  const histWindow = macd
    .slice(Math.max(0, i - 39), i + 1)
    .map((item) => (item ? Math.abs(item.hist) : 0));
  const peak = Math.max(...histWindow, 0.0001);
  const nearZeroAxis = cur.hist < 0 && Math.abs(cur.hist) <= peak * 0.35;

  const threeDayPct =
    closes.length >= 4 && closes[i - 3] > 0 ? ((closes[i] / closes[i - 3] - 1) * 100) : null;

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
    ma5TurnUp: ma5 > ma5Prev && (ma5Prev <= ma5Prev2 || ma5Prev2 <= ma5Prev3),
    deathCross: cur.dif < cur.dea,
    greenShrinking: cur.hist < 0 && prev.hist < 0 && prev2.hist < 0 && cur.hist > prev.hist && prev.hist > prev2.hist,
    nearZeroAxis,
    threeDayPct,
  };
}

export function passesBoardTech(tech: TechFlags): boolean {
  return tech.aboveMa5 && tech.ma5TurnUp && tech.deathCross && tech.greenShrinking && tech.nearZeroAxis;
}

export function passesStockTech(tech: TechFlags, turnover: number | null): boolean {
  if (!passesBoardTech(tech)) return false;
  if (tech.threeDayPct == null || tech.threeDayPct > 4) return false;
  if (turnover == null || turnover < 2) return false;
  return true;
}
