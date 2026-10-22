/**
 * 用分时均价线、MACDFS(12,26,9)、KDJ(9,3,3) 和成交量标出趋势变弱的顶和底。不是同花顺的公式。
 * 柱 = 2 * (DIF - DEA)。红柱是 DIF > DEA，绿柱是 DEA > DIF。
 * KDJ 用最近 9 分钟分时价的最高最低算 RSV，K/D 按 1/3、2/3 递推，J = 3K - 2D。
 *
 * 最近 4 分钟的价格、MACDFS 柱各做一次一元线性回归。斜率为正是向上，越大涨得越快；
 * 斜率为负是向下，越负跌得越快。再用 4 周期 EMA 看这 4 分钟里的短期步伐。
 * 顶：现价在均价线上方或下方，DIF > DEA，两条斜率仍为正但变弱，两条 EMA 抬升变慢，
 *     并且 KDJ 的 J 在超买区，这一分钟量不低于近 5 分钟均量的六成（有量滞涨，滤掉无量虚顶）。
 * 底：现价在均价线下方，DEA > DIF，两条斜率仍为负但变弱，两条 EMA 下跌变慢，
 *     并且 KDJ 的 J 在超卖区，这一分钟有成交且量不超过近 5 分钟均量的 1.5 倍（滤掉无量和天量杀跌）。
 * 同一段连续满足时只标第一分钟。之后顶和底交替。
 * 还没配上对面时，更高的顶要红柱不低于前一个顶的八成才换掉；更低的底直接换掉前一个底。
 * 贴着均价线也可以标。配成一对时，个股顶底波动至少 1.5%，ETF 至少 0.5%。
 * 波动按 (高 - 低) / 低。不够的对面丢掉。
 */

/** 个股一对顶底至少要有这么多相对波动。 */
const STOCK_SWING = 0.015;
/** ETF 一对顶底至少要有这么多相对波动。 */
const ETF_SWING = 0.005;
/** 回归和短期 EMA 都看这么多分钟。 */
const WINDOW = 4;
/** 更高的价格要配上差不多高的红柱，才换掉已经标出的顶。 */
const REPLACE_HIST_RATIO = 0.8;
const KDJ_PERIOD = 9;
/** J 到这里才算超买，配合 MACD 变弱才标顶。 */
const KDJ_OVERBOUGHT = 70;
/** J 到这里才算超卖，配合 MACD 变弱才标底。 */
const KDJ_OVERSOLD = 30;
const VOLUME_LOOKBACK = 5;
/** 顶这一分钟至少要有近 5 分钟均量的六成，否则只是无量抖动。 */
const TOP_MIN_VOLUME_RATIO = 0.6;
/** 底这一分钟超过近 5 分钟均量的 1.5 倍，当作天量续跌，不标底。 */
const BOTTOM_MAX_VOLUME_RATIO = 1.5;

export type IntradayMinute = {
  time: string;
  price: number;
  volume: number;
  avg: number | null;
};

export type IntradayMark = {
  index: number;
  time: string;
  side: "bottom" | "top";
  price: number;
};

export type MacdfsBar = { dif: number; dea: number; hist: number };

export type KdjBar = { k: number; d: number; j: number };

type Candidate = IntradayMark & { hist: number };

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

/** 分时价的 KDJ(9,3,3)。没有高低开，就用这 9 分钟现价的最高最低。 */
export function kdjSeries(prices: number[], period = KDJ_PERIOD): Array<KdjBar | null> {
  const out: Array<KdjBar | null> = Array(prices.length).fill(null);
  if (prices.length < period) return out;
  let k = 50;
  let d = 50;
  for (let i = period - 1; i < prices.length; i += 1) {
    let high = -Infinity;
    let low = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      high = Math.max(high, prices[j]);
      low = Math.min(low, prices[j]);
    }
    const rsv = high === low ? 50 : ((prices[i] - low) / (high - low)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    out[i] = { k, d, j: 3 * k - 2 * d };
  }
  return out;
}

export function recentVolumeAvg(points: IntradayMinute[], index: number, lookback = VOLUME_LOOKBACK): number | null {
  const from = Math.max(0, index - lookback);
  const count = index - from;
  if (count <= 0) return null;
  let sum = 0;
  for (let i = from; i < index; i += 1) sum += points[i].volume;
  return sum / count;
}

/** 一对顶底的相对波动 (高 - 低) / 低。个股至少 1.5%，ETF 至少 0.5%。 */
export function pairSwingCovers(low: number, high: number, etf = false): boolean {
  if (!(high > low) || !(low > 0)) return false;
  return (high - low) / low >= (etf ? ETF_SWING : STOCK_SWING);
}

/** 最近 WINDOW 根对时间 0..WINDOW-1 的一元回归斜率。 */
export function linearSlope(values: number[], index: number): number | null {
  if (index < WINDOW - 1) return null;
  let sumY = 0;
  let sumXY = 0;
  for (let step = 0; step < WINDOW; step += 1) {
    const value = values[index - (WINDOW - 1) + step];
    if (!Number.isFinite(value)) return null;
    sumY += value;
    sumXY += step * value;
  }
  const sumX = (WINDOW * (WINDOW - 1)) / 2;
  const sumX2 = (WINDOW * (WINDOW - 1) * (2 * WINDOW - 1)) / 6;
  const denom = WINDOW * sumX2 - sumX * sumX;
  return (WINDOW * sumXY - sumX * sumY) / denom;
}

function emaOnSeries(values: number[], period: number): Array<number | null> {
  const start = values.findIndex((value) => Number.isFinite(value));
  if (start < 0) return Array(values.length).fill(null);
  const tail = values.slice(start);
  if (tail.some((value) => !Number.isFinite(value))) return Array(values.length).fill(null);
  return [...Array(start).fill(null), ...emaSeries(tail, period)];
}

function slopeCandidates(points: IntradayMinute[]): Candidate[] {
  const prices = points.map((point) => point.price);
  const macd = macdfsSeries(prices);
  const kdj = kdjSeries(prices);
  const hist = macd.map((bar) => bar?.hist ?? Number.NaN);
  const priceEma = emaSeries(prices, WINDOW);
  const histEma = emaOnSeries(hist, WINDOW);
  const candidates: Candidate[] = [];
  let lastSide: "top" | "bottom" | null = null;
  let lastIndex = -1;

  for (let i = WINDOW + 1; i < points.length; i += 1) {
    const priceSlope = linearSlope(prices, i);
    const prevPriceSlope = linearSlope(prices, i - 1);
    const histSlope = linearSlope(hist, i);
    const prevHistSlope = linearSlope(hist, i - 1);
    const priceNow = priceEma[i];
    const pricePrev = priceEma[i - 1];
    const priceOlder = priceEma[i - 2];
    const histNow = histEma[i];
    const histPrev = histEma[i - 1];
    const histOlder = histEma[i - 2];
    if (
      priceSlope == null ||
      prevPriceSlope == null ||
      histSlope == null ||
      prevHistSlope == null ||
      priceNow == null ||
      pricePrev == null ||
      priceOlder == null ||
      histNow == null ||
      histPrev == null ||
      histOlder == null
    ) {
      continue;
    }
    const bar = macd[i];
    const oscillator = kdj[i];
    const avgVol = recentVolumeAvg(points, i);
    const volRatio = avgVol != null && avgVol > 0 ? points[i].volume / avgVol : null;
    const aboveAvg = points[i].avg != null && points[i].price > (points[i].avg as number);
    const belowAvg = points[i].avg != null && points[i].price < (points[i].avg as number);
    const difAbove = Boolean(bar && bar.dif > bar.dea);
    const deaAbove = Boolean(bar && bar.dea > bar.dif);
    const kdjOverbought = Boolean(oscillator && oscillator.j >= KDJ_OVERBOUGHT);
    const kdjOversold = Boolean(oscillator && oscillator.j <= KDJ_OVERSOLD);
    const volumeOkForTop = points[i].volume > 0 && (volRatio == null || volRatio >= TOP_MIN_VOLUME_RATIO);
    const volumeOkForBottom = points[i].volume > 0 && (volRatio == null || volRatio <= BOTTOM_MAX_VOLUME_RATIO);
    const pricePace = priceNow - pricePrev;
    const prevPricePace = pricePrev - priceOlder;
    const histPace = histNow - histPrev;
    const prevHistPace = histPrev - histOlder;
    const riseWeakening =
      priceSlope > 0 &&
      histSlope > 0 &&
      priceSlope < prevPriceSlope &&
      histSlope < prevHistSlope &&
      pricePace < prevPricePace &&
      histPace < prevHistPace;
    const dropWeakening =
      priceSlope < 0 &&
      histSlope < 0 &&
      priceSlope > prevPriceSlope &&
      histSlope > prevHistSlope &&
      pricePace > prevPricePace &&
      histPace > prevHistPace;
    let side: "top" | "bottom" | null = null;
    if ((aboveAvg || belowAvg) && difAbove && riseWeakening && kdjOverbought && volumeOkForTop) side = "top";
    else if (belowAvg && deaAbove && dropWeakening && kdjOversold && volumeOkForBottom) side = "bottom";
    if (!side) {
      lastSide = null;
      continue;
    }
    if (side === lastSide && i === lastIndex + 1) {
      lastIndex = i;
      continue;
    }
    lastSide = side;
    lastIndex = i;
    candidates.push({
      index: i,
      time: points[i].time,
      side,
      price: points[i].price,
      hist: hist[i],
    });
  }
  return candidates;
}

function dropMark(marks: Candidate[], target: Candidate) {
  const index = marks.findIndex((mark) => mark.index === target.index && mark.side === target.side);
  if (index >= 0) marks.splice(index, 1);
}

export function intradayExtremes(points: IntradayMinute[], options?: { etf?: boolean }): IntradayMark[] {
  if (points.length < WINDOW + 2) return [];
  const etf = Boolean(options?.etf);
  const marks: Candidate[] = [];
  let seek: "either" | "bottom" | "top" = "either";
  let openBottom: Candidate | null = null;
  let openTop: Candidate | null = null;

  for (const candidate of slopeCandidates(points)) {
    if (candidate.side === "top") {
      if (
        seek === "bottom" &&
        openTop &&
        candidate.price > openTop.price &&
        candidate.hist >= openTop.hist * REPLACE_HIST_RATIO
      ) {
        dropMark(marks, openTop);
        openTop = candidate;
        marks.push(candidate);
        continue;
      }
      if (seek === "either") {
        openTop = candidate;
        marks.push(candidate);
        seek = "bottom";
        continue;
      }
      if (seek !== "top" || !openBottom || !pairSwingCovers(openBottom.price, candidate.price, etf)) continue;
      openTop = candidate;
      marks.push(candidate);
      seek = "bottom";
      openBottom = null;
      continue;
    }

    if (seek === "top" && openBottom && candidate.price < openBottom.price) {
      dropMark(marks, openBottom);
      openBottom = candidate;
      marks.push(candidate);
      continue;
    }
    if (seek === "either") {
      openBottom = candidate;
      marks.push(candidate);
      seek = "top";
      continue;
    }
    if (seek !== "bottom" || !openTop || !pairSwingCovers(candidate.price, openTop.price, etf)) continue;
    openBottom = candidate;
    marks.push(candidate);
    seek = "top";
    openTop = null;
  }

  return marks.map(({ index, time, side, price }) => ({ index, time, side, price }));
}
