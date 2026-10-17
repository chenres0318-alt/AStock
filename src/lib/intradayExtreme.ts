/**
 * 用分时 MACDFS(12,26,9) 模拟顶底。不是同花顺的公式。
 * 柱 = 2 * (DIF - DEA)。
 *
 * 顶：DIF、DEA 都在 0 轴上方，这一根是当天最高的红柱，DIF > DEA，
 *     下一根仍是红柱但更短，并且这一分钟创出日内新高后下一分钟不再创新高。
 * 底：DIF、DEA 都在 0 轴下方，这一根是当天最长的绿柱，DEA > DIF，
 *     下一根仍是绿柱但更短，并且这一分钟创出日内新低后下一分钟不再创新低。
 * 先有底才能标顶，先有顶才能再标下一个底。
 * 一对手的差价要盖过 5 元佣金，再加这一手卖出价的 0.05% 印花税，否则不标。
 * 底还没配上顶时，更低的底换掉前一个底；顶还没配上下一个底时，更高的顶换掉前一个顶。
 */

const LOT = 100;
const COMMISSION = 5;
const STAMP_RATE = 0.0005;
/** 柱高接近 0 时只是浮点毛刺，不算红柱或绿柱。 */
const MIN_COLUMN = 1e-4;

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

export type MacdfsBar = { dif: number; dea: number; hist: number };

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

export function macdfsSeries(prices: number[]): Array<MacdfsBar | null> {
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
  const out: Array<MacdfsBar | null> = Array(prices.length).fill(null);
  for (let j = 0; j < difVals.length; j += 1) {
    if (deaVals[j] == null) continue;
    const dif = difVals[j];
    const dea = deaVals[j]!;
    out[map[j]] = { dif, dea, hist: 2 * (dif - dea) };
  }
  return out;
}

/** 一手买卖的差价，要多于 5 元佣金加卖出一手的印花税。 */
export function lotSpreadCoversCost(low: number, high: number): boolean {
  if (!(high > low)) return false;
  const spread = (high - low) * LOT;
  const stamp = high * LOT * STAMP_RATE;
  return spread > COMMISSION + stamp;
}

function waveHoldsSessionExtreme(prices: number[], hist: number[], index: number, side: "bottom" | "top"): boolean {
  const wantHigh = side === "top";
  let start = index;
  while (start > 0) {
    const prev = hist[start - 1];
    if (wantHigh ? !(prev > 0) : !(prev < 0)) break;
    start -= 1;
  }
  let extreme = prices[start];
  for (let j = start; j <= index; j += 1) {
    extreme = wantHigh ? Math.max(extreme, prices[j]) : Math.min(extreme, prices[j]);
  }
  let session = prices[0];
  for (let j = 1; j <= index; j += 1) {
    session = wantHigh ? Math.max(session, prices[j]) : Math.min(session, prices[j]);
  }
  if (extreme !== session) return false;
  return wantHigh ? session > prices[0] : session < prices[0];
}

function dropMark(marks: IntradayMark[], target: IntradayMark) {
  const index = marks.findIndex((mark) => mark.index === target.index && mark.side === target.side);
  if (index >= 0) marks.splice(index, 1);
}

export function intradayExtremes(points: IntradayMinute[]): IntradayMark[] {
  if (points.length < 3) return [];
  const macd = macdfsSeries(points.map((point) => point.price));
  const prices = points.map((point) => point.price);
  const hist = macd.map((bar) => bar?.hist ?? 0);
  const candidates: IntradayMark[] = [];
  let maxRed = 0;
  let minGreen = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const bar = macd[i];
    const next = macd[i + 1];
    if (!bar || !next) continue;
    const price = prices[i];
    const nextPrice = prices[i + 1];
    if (
      bar.dif > 0 &&
      bar.dea > 0 &&
      bar.dif > bar.dea &&
      bar.hist > MIN_COLUMN &&
      bar.hist >= maxRed &&
      next.hist > 0 &&
      next.hist < bar.hist &&
      waveHoldsSessionExtreme(prices, hist, i, "top") &&
      nextPrice <= Math.max(...prices.slice(0, i + 1))
    ) {
      candidates.push({ index: i, time: points[i].time, side: "top", price });
    }
    if (
      bar.dif < 0 &&
      bar.dea < 0 &&
      bar.dea > bar.dif &&
      bar.hist < -MIN_COLUMN &&
      bar.hist <= minGreen &&
      next.hist < 0 &&
      next.hist > bar.hist &&
      waveHoldsSessionExtreme(prices, hist, i, "bottom") &&
      nextPrice >= Math.min(...prices.slice(0, i + 1))
    ) {
      candidates.push({ index: i, time: points[i].time, side: "bottom", price });
    }
    if (bar.hist > maxRed) maxRed = bar.hist;
    if (bar.hist < minGreen) minGreen = bar.hist;
  }

  const marks: IntradayMark[] = [];
  let seek: "bottom" | "top" = "bottom";
  let openBottom: IntradayMark | null = null;
  let openTop: IntradayMark | null = null;

  for (const candidate of candidates) {
    if (candidate.side === "bottom") {
      if (seek === "top" && openBottom && candidate.price < openBottom.price) {
        dropMark(marks, openBottom);
        openBottom = candidate;
        marks.push(candidate);
        continue;
      }
      if (seek !== "bottom") continue;
      if (openTop && !lotSpreadCoversCost(candidate.price, openTop.price)) continue;
      if (openBottom && candidate.price >= openBottom.price) continue;
      if (openBottom) dropMark(marks, openBottom);
      openBottom = candidate;
      marks.push(candidate);
      seek = "top";
      openTop = null;
      continue;
    }

    if (seek === "bottom" && openTop && candidate.price > openTop.price) {
      dropMark(marks, openTop);
      openTop = candidate;
      marks.push(candidate);
      continue;
    }
    if (seek !== "top" || !openBottom || !lotSpreadCoversCost(openBottom.price, candidate.price)) continue;
    openTop = candidate;
    marks.push(candidate);
    seek = "bottom";
    openBottom = null;
  }
  return marks;
}
