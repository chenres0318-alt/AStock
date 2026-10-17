/**
 * 用分时 MACDFS(12,26,9) 标出一轮红柱或绿柱的转折。不是同花顺的公式。
 * 柱 = 2 * (DIF - DEA)。
 *
 * 顶：同一段红柱先堆高，再从最高的红柱缩短。DIF > DEA，0 轴上下都算。
 *     这一分钟是附近高点，下一分钟不再更高，成交量也小于前 8 分钟里的最大量。
 * 底：同一段绿柱先拉长，再从最长的绿柱缩短。DIF、DEA 都在 0 轴下方且 DEA > DIF。
 *     这一分钟是附近低点，下一分钟不再更低，成交量也小于前 8 分钟里的最大量。
 * 同色柱没堆满 3 分钟，或柱高不到股价的万分之五，不算。
 * 顶和底哪一边先出现都可以，之后交替。还没配上对面时，更高的顶要红柱不低于前一个顶的八成才换掉；
 * 更低的底直接换掉前一个底。配成一对时，一手差价要盖过 5 元佣金，再加这一手卖出价的 0.05% 印花税。
 */

const LOT = 100;
const COMMISSION = 5;
const STAMP_RATE = 0.0005;
/** 柱高接近 0 时只是浮点毛刺，不算红柱或绿柱。 */
const MIN_COLUMN = 1e-4;
/** 同色柱至少先走出这么多分钟，极值才算这一波的顶或底。 */
const BUILD_BARS = 3;
const VOLUME_LOOKBACK = 8;
/** 柱高达到这一波极值的九成四以上时，取其中更极端的价格。 */
const PEAK_BAND = 0.06;
/** 柱高至少要到股价的这个比例，太短的柱子没有做 T 的空间。 */
const HIST_FLOOR_RATIO = 0.0005;
/** 更高的价格要配上差不多高的红柱，才换掉已经标出的顶。 */
const REPLACE_HIST_RATIO = 0.8;

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

/** 一手买卖的差价，要多于 5 元佣金加卖出一手的印花税。 */
export function lotSpreadCoversCost(low: number, high: number): boolean {
  if (!(high > low)) return false;
  const spread = (high - low) * LOT;
  const stamp = high * LOT * STAMP_RATE;
  return spread > COMMISSION + stamp;
}

function maxVolumeBefore(points: IntradayMinute[], index: number): number {
  let vmax = 0;
  for (let j = Math.max(0, index - VOLUME_LOOKBACK); j < index; j += 1) {
    vmax = Math.max(vmax, points[j].volume);
  }
  return vmax;
}

function waveCandidates(points: IntradayMinute[]): Candidate[] {
  const macd = macdfsSeries(points.map((point) => point.price));
  const hist = macd.map((bar) => bar?.hist ?? 0);
  const candidates: Candidate[] = [];

  let i = 0;
  while (i < points.length) {
    if (!macd[i] || Math.abs(hist[i]) < MIN_COLUMN) {
      i += 1;
      continue;
    }
    const red = hist[i] > 0;
    const start = i;
    while (i < points.length && macd[i] && (red ? hist[i] > MIN_COLUMN : hist[i] < -MIN_COLUMN)) i += 1;
    const end = i - 1;

    let ext = start;
    for (let j = start + 1; j <= end; j += 1) {
      if (red ? hist[j] > hist[ext] : hist[j] < hist[ext]) ext = j;
    }
    if (ext - start < BUILD_BARS) continue;
    let shrunk = false;
    for (let j = ext + 1; j <= end; j += 1) {
      if (red ? hist[j] < hist[ext] : hist[j] > hist[ext]) {
        shrunk = true;
        break;
      }
    }
    if (!shrunk || Math.abs(hist[ext]) < points[ext].price * HIST_FLOOR_RATIO) continue;

    let mark = ext;
    const from = Math.max(start, ext - 2);
    const to = Math.min(end, ext + 1);
    for (let j = from; j <= to; j += 1) {
      if (Math.abs(hist[j]) < Math.abs(hist[ext]) * (1 - PEAK_BAND)) continue;
      if (red ? points[j].price > points[mark].price : points[j].price < points[mark].price) mark = j;
    }
    if (mark === 0 || mark + 1 >= points.length) continue;

    const price = points[mark].price;
    const prev = points[mark - 1].price;
    const next = points[mark + 1].price;
    if (red ? !(price >= prev && next < price) : !(price <= prev && next > price)) continue;

    const column = macd[ext];
    if (!column) continue;
    if (red) {
      if (!(column.dif > column.dea)) continue;
    } else if (!(column.dif < 0 && column.dea < 0 && column.dea > column.dif)) continue;

    const volume = points[mark].volume;
    if (!(volume > 0 && volume < maxVolumeBefore(points, mark))) continue;

    candidates.push({
      index: mark,
      time: points[mark].time,
      side: red ? "top" : "bottom",
      price,
      hist: hist[ext],
    });
  }
  return candidates;
}

function dropMark(marks: Candidate[], target: Candidate) {
  const index = marks.findIndex((mark) => mark.index === target.index && mark.side === target.side);
  if (index >= 0) marks.splice(index, 1);
}

export function intradayExtremes(points: IntradayMinute[]): IntradayMark[] {
  if (points.length < 3) return [];
  const marks: Candidate[] = [];
  let seek: "either" | "bottom" | "top" = "either";
  let openBottom: Candidate | null = null;
  let openTop: Candidate | null = null;

  for (const candidate of waveCandidates(points)) {
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
      if (seek !== "top" || !openBottom || !lotSpreadCoversCost(openBottom.price, candidate.price)) continue;
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
    if (seek !== "bottom" || !openTop || !lotSpreadCoversCost(candidate.price, openTop.price)) continue;
    openBottom = candidate;
    marks.push(candidate);
    seek = "top";
    openTop = null;
  }

  return marks.map(({ index, time, side, price }) => ({ index, time, side, price }));
}
