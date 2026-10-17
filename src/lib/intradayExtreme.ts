/**
 * 用分时 MACDFS(12,26,9) 模拟顶底。不是同花顺的公式。
 *
 * DIF 下穿 DEA，且这一波红柱已经缩短，标顶。
 * DIF 上穿 DEA，且这一波绿柱已经缩短，标底。
 * 零轴下方的金叉要等红柱放出来：红柱高度不到前一波绿柱的一半，或红柱没放大就又缩短，不标底。
 * 柱的算法和日线 MACD 一样，柱 = 2 * (DIF - DEA)。
 */

const RED_ENOUGH = 0.5;
const MIN_GAP = 5;
/** 这一波柱高不到当天已出现过的最大柱的这个比例，当作毛刺，不标。 */
const MIN_WAVE = 0.35;
/** 红柱或绿柱至少连续缩短这么多根，才算量能不足。 */
const MIN_SHRINK = 2;

export type IntradayMinute = {
  time: string;
  price: number;
  volume: number;
};

export type IntradayMark = {
  index: number;
  time: string;
  side: "bottom" | "top";
  price: number;
};

type MacdBar = { dif: number; dea: number; hist: number };

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

function macdfs(prices: number[]): Array<MacdBar | null> {
  const ema12 = emaSeries(prices, 12);
  const ema26 = emaSeries(prices, 26);
  const difVals: number[] = [];
  const map: number[] = [];
  for (let i = 0; i < prices.length; i += 1) {
    if (ema12[i] == null || ema26[i] == null) continue;
    difVals.push(ema12[i]! - ema26[i]!);
    map.push(i);
  }
  const deaVals = emaSeries(difVals, 9);
  const out: Array<MacdBar | null> = Array(prices.length).fill(null);
  for (let j = 0; j < difVals.length; j += 1) {
    if (deaVals[j] == null) continue;
    const dif = difVals[j];
    const dea = deaVals[j]!;
    out[map[j]] = { dif, dea, hist: 2 * (dif - dea) };
  }
  return out;
}

function redWave(hist: number[], end: number): { faded: boolean; peak: number } {
  let peak = 0;
  let shrink = 0;
  for (let j = end; j >= 0; j -= 1) {
    if (hist[j] < 0) break;
    if (hist[j] > peak) peak = hist[j];
  }
  for (let j = end; j >= 1 && hist[j] >= 0 && hist[j] <= hist[j - 1]; j -= 1) shrink += 1;
  return { faded: peak > 0 && shrink >= MIN_SHRINK, peak };
}

function greenWave(hist: number[], end: number): { faded: boolean; depth: number } {
  let trough = 0;
  let shrink = 0;
  for (let j = end; j >= 0; j -= 1) {
    if (hist[j] > 0) break;
    if (hist[j] < trough) trough = hist[j];
  }
  for (let j = end; j >= 1 && hist[j] <= 0 && hist[j] >= hist[j - 1]; j -= 1) shrink += 1;
  return { faded: trough < 0 && shrink >= MIN_SHRINK, depth: Math.abs(trough) };
}

/** 零轴下金叉之后，红柱要放到前一波绿柱的一半以上，才算底。 */
function redWaveEnough(hist: number[], from: number, greenDepth: number): boolean {
  if (!(greenDepth > 0)) return false;
  let peak = 0;
  for (let j = from; j < hist.length; j += 1) {
    const bar = hist[j];
    if (bar > peak) peak = bar;
    if (peak >= greenDepth * RED_ENOUGH) return true;
    const rolledOver = j > from && peak > 0 && bar < peak * 0.7;
    const flippedGreen = j > from && bar <= 0;
    if ((rolledOver || flippedGreen) && peak < greenDepth * RED_ENOUGH) return false;
  }
  return false;
}

export function intradayExtremes(points: IntradayMinute[]): IntradayMark[] {
  if (points.length < 40) return [];
  const macd = macdfs(points.map((point) => point.price));
  const hist = macd.map((bar) => bar?.hist ?? 0);
  const marks: IntradayMark[] = [];
  let lastTop = -MIN_GAP;
  let lastBottom = -MIN_GAP;
  let biggest = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = macd[i - 1];
    const cur = macd[i];
    if (!prev || !cur) continue;
    const death = prev.dif >= prev.dea && cur.dif < cur.dea;
    const golden = prev.dif <= prev.dea && cur.dif > cur.dea;
    if (!death && !golden) continue;

    if (death && i - lastTop >= MIN_GAP) {
      const red = redWave(hist, i - 1);
      if (red.peak > biggest) biggest = red.peak;
      if (red.faded && red.peak >= biggest * MIN_WAVE) {
        marks.push({ index: i, time: points[i].time, side: "top", price: points[i].price });
        lastTop = i;
      }
      continue;
    }

    if (!(golden && i - lastBottom >= MIN_GAP)) continue;
    const green = greenWave(hist, i - 1);
    if (green.depth > biggest) biggest = green.depth;
    if (!green.faded || green.depth < biggest * MIN_WAVE) continue;
    const belowZero = cur.dif < 0 && cur.dea < 0;
    if (belowZero && !redWaveEnough(hist, i, green.depth)) continue;
    marks.push({ index: i, time: points[i].time, side: "bottom", price: points[i].price });
    lastBottom = i;
  }
  return marks;
}
