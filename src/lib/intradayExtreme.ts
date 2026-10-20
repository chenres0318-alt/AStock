/**
 * 用分时均价线和 MACDFS(12,26,9) 标出趋势变弱的顶和底。不是同花顺的公式。
 * 柱 = 2 * (DIF - DEA)。红柱是 DIF > DEA，绿柱是 DEA > DIF。
 *
 * 最近 4 分钟的价格、MACDFS 柱各做一次一元线性回归。斜率为正是向上，越大涨得越快；
 * 斜率为负是向下，越负跌得越快。再用 4 周期 EMA 看这 4 分钟里的短期步伐。
 * 顶：现价在均价线上方或下方，并且 DIF > DEA。两条斜率仍为正，但都比上一分钟小，两条 EMA 的抬升也变慢。
 * 底：现价在均价线下方，并且 DEA > DIF。两条斜率仍为负，但都比上一分钟更靠近 0，两条 EMA 的下跌也变慢。
 * 同一段连续满足时只标第一分钟。之后顶和底交替。
 * 还没配上对面时，更高的顶要红柱不低于前一个顶的八成才换掉；更低的底直接换掉前一个底。
 * 配成一对时，股票一手差价要盖过 5 元最低佣金，再加卖出一手的 0.05% 印花税。
 * ETF 免 5 元最低佣金，只看印花税。
 */

const LOT = 100;
const COMMISSION = 5;
const STAMP_RATE = 0.0005;
/** 回归和短期 EMA 都看这么多分钟。 */
const WINDOW = 4;
/** 更高的价格要配上差不多高的红柱，才换掉已经标出的顶。 */
const REPLACE_HIST_RATIO = 0.8;

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

/** 一手买卖的差价，要多于最低佣金加卖出一手的印花税。ETF 把最低佣金传 0。 */
export function lotSpreadCoversCost(low: number, high: number, minCommission = COMMISSION): boolean {
  if (!(high > low)) return false;
  const spread = (high - low) * LOT;
  const stamp = high * LOT * STAMP_RATE;
  return spread > minCommission + stamp;
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
    const aboveAvg = points[i].avg != null && points[i].price > (points[i].avg as number);
    const belowAvg = points[i].avg != null && points[i].price < (points[i].avg as number);
    const difAbove = Boolean(bar && bar.dif > bar.dea);
    const deaAbove = Boolean(bar && bar.dea > bar.dif);
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
    if ((aboveAvg || belowAvg) && difAbove && riseWeakening) side = "top";
    else if (belowAvg && deaAbove && dropWeakening) side = "bottom";
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

export function intradayExtremes(points: IntradayMinute[], options?: { minCommission?: number }): IntradayMark[] {
  if (points.length < WINDOW + 2) return [];
  const minCommission = options?.minCommission ?? COMMISSION;
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
      if (seek !== "top" || !openBottom || !lotSpreadCoversCost(openBottom.price, candidate.price, minCommission)) continue;
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
    if (seek !== "bottom" || !openTop || !lotSpreadCoversCost(candidate.price, openTop.price, minCommission)) continue;
    openBottom = candidate;
    marks.push(candidate);
    seek = "top";
    openTop = null;
  }

  return marks.map(({ index, time, side, price }) => ({ index, time, side, price }));
}
