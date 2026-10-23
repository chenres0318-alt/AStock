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
 * 同一段连续满足时只标第一分钟。之后顶和底交替。看盘默认先出底再找顶，先走出的顶不当普通顶。
 * 还没配上对面时，更高的顶要红柱不低于前一个顶的八成才换掉；更低的底直接换掉前一个底。
 * 贴着均价线也可以标。配成一对时，个股顶底波动至少 1.5%，ETF 至少 0.5%。
 * 波动按 (高 - 低) / 低。9:45 之后相对波动够了也可以先标第一个底，不必等 MACD 形态，盘中就能看到。
 * 9:30 到 9:45 先急拉出一对波动、10:00 前又吐回至少一半的，当作开盘冲高回落，这段时间不标顶底。
 * 对面除了再等形态，价格相对达到这档波动也可以直接标，然后开始下一对。
 * 价位指数看 9:45 之后的日内高低：(现价 - 最低) / (最高 - 最低) × 100。越高越靠近高位，越低越靠近低位。
 * 顶的可信度等于价位指数，底的可信度等于 100 减去价位指数。
 * 看盘默认只标可信度 70 及以上的顶底；区间展开后不够 70 的会藏掉。
 * 到 14:45 还只有底、没有 70 以上的顶时，14:45 到 14:52 的现价只要比底高就标成顶。
 * 尾盘 14:50 现价仍同时低于日线 MA4 和 MA7 时，标清仓离场。
 * MACDFS 仍用 12/26/9。单独从今天 9:30 起算时，EMA26 和 DEA9 要到约 10:04 才有柱。
 * 方案 A：带上前一个交易日尾盘至少 26 根 1 分钟收盘，用昨收处的 EMA 当初始状态，再接着算今天。
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
/** 价位指数从这一分钟起算当日高低，避开开盘前 15 分钟。 */
const RANGE_START = "09:45";
const RANGE_END = "15:00";
const OPEN_BELL = "09:30";
/** 开盘急拉看这一段的高点。 */
const OPEN_SPIKE_END = "09:45";
/** 急拉后又快速回落时，顶底标记推迟到这一分钟之后。 */
const OPEN_QUIET_END = "10:00";
/** 从开盘高点吐回这么多，才认定是冲高回落。 */
const OPEN_DUMP_RETRACE = 0.5;
/** 到这一分钟还没有 70 顶、只剩底时，现价比底高就补一个卖顶。 */
const FORCE_TOP_DEADLINE = "14:45";
/** 补卖顶只看到这一分钟的现价，14:52 之后不再跟着走。 */
const FORCE_TOP_END = "14:52";
/** 现价仍低于日线 MA4 和 MA7 时，在这一分钟标清仓离场。 */
const CLEAR_EXIT_DEADLINE = "14:50";
/** 看盘默认只标可信度达到这一档的顶底。 */
export const MIN_MARK_CONFIDENCE = 70;
/** MACDFS 快线、慢线、信号线，参数保持 12/26/9。 */
export const MACDFS_FAST = 12;
export const MACDFS_SLOW = 26;
export const MACDFS_SIGNAL = 9;
/** 昨尾盘至少这么多 1 分钟收盘，EMA26 才能接到今天开盘。 */
export const MACDFS_PRIOR_MIN = 26;
/** 实际多取一些，让 DEA(9) 在昨收就成型，今天 9:30 就有柱。 */
export const MACDFS_PRIOR_BARS = 40;

export type IntradayMinute = {
  time: string;
  price: number;
  volume: number;
  avg: number | null;
};

export type IntradayMark = {
  index: number;
  time: string;
  side: "bottom" | "top" | "clear";
  price: number;
  /** 9:45 后日内位置，0 是最低，100 是最高。 */
  position: number | null;
  /** 顶看高位、底看低位，0 到 100。 */
  confidence: number | null;
};

export type MacdfsBar = { dif: number; dea: number; hist: number };

export type KdjBar = { k: number; d: number; j: number };

type Candidate = {
  index: number;
  time: string;
  side: "bottom" | "top";
  price: number;
  hist: number;
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

function macdfsFrom(prices: number[]): Array<MacdfsBar | null> {
  const ema12 = emaSeries(prices, MACDFS_FAST);
  const ema26 = emaSeries(prices, MACDFS_SLOW);
  const difVals: number[] = [];
  const map: number[] = [];
  for (let i = 0; i < prices.length; i += 1) {
    if (ema12[i] == null || ema26[i] == null) continue;
    difVals.push(ema12[i]! - ema26[i]!);
    map.push(i);
  }
  const deaVals = emaSeries(difVals, MACDFS_SIGNAL);
  const out: Array<MacdfsBar | null> = Array(prices.length).fill(null);
  for (let j = 0; j < difVals.length; j += 1) {
    if (deaVals[j] == null) continue;
    const dif = difVals[j];
    const dea = deaVals[j]!;
    out[map[j]] = { dif, dea, hist: 2 * (dif - dea) };
  }
  return out;
}

/**
 * 算 MACDFS(12,26,9)。priorPrices 是前一个交易日尾盘 1 分钟收盘，
 * 用那段序列结尾的 EMA 当今天的初始状态，再继续往下算。
 */
export function macdfsSeries(prices: number[], priorPrices: number[] = []): Array<MacdfsBar | null> {
  const prefix = priorPrices.filter((price) => Number.isFinite(price) && price > 0);
  if (!prefix.length) return macdfsFrom(prices);
  return macdfsFrom([...prefix, ...prices]).slice(prefix.length);
}

/** 从 1 分钟 K 线里取出前一个交易日尾盘收盘价，至少 min 根，最多 take 根。 */
export function pickPriorCloses(
  bars: Array<{ date: string; close: number }>,
  today: string | null,
  take = MACDFS_PRIOR_BARS,
  min = MACDFS_PRIOR_MIN,
): number[] {
  if (!bars.length) return [];
  const todayKey = (today ?? "").replace(/-/g, "").slice(0, 8);
  const dates = Array.from(new Set(bars.map((bar) => bar.date))).sort();
  const priorDate = todayKey
    ? [...dates].reverse().find((date) => date < todayKey)
    : dates.length >= 2
      ? dates[dates.length - 2]
      : null;
  if (!priorDate) return [];
  const prior = bars.filter((bar) => bar.date === priorDate && Number.isFinite(bar.close) && bar.close > 0);
  if (prior.length < min) return [];
  return prior.slice(-take).map((bar) => bar.close);
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

/** 9:45 到 15:00 的最高最低。开盘前 15 分钟不进区间。 */
export function sessionRangeAfter(
  points: IntradayMinute[],
  start = RANGE_START,
  end = RANGE_END,
): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  for (const point of points) {
    if (point.time < start || point.time > end) continue;
    if (!Number.isFinite(point.price)) continue;
    high = Math.max(high, point.price);
    low = Math.min(low, point.price);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high < low) return null;
  return { high, low };
}

/** (现价 - 最低) / (最高 - 最低) × 100。贴在区间外就夹到 0 或 100。 */
export function positionIndex(price: number, range: { high: number; low: number } | null): number | null {
  if (!range || !Number.isFinite(price)) return null;
  const span = range.high - range.low;
  if (!(span > 0)) return null;
  const raw = ((price - range.low) / span) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/** 顶要在高位才像样，底要在低位才像样。 */
export function markConfidence(side: "top" | "bottom", position: number | null): number | null {
  if (position == null) return null;
  return side === "top" ? position : 100 - position;
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

/** 9:30–9:45 已从开盘价拉出一对波动，且当前价吐回了至少一半。 */
function isOpenSpikeDump(points: IntradayMinute[], index: number, etf: boolean): boolean {
  if (index < 0 || index >= points.length) return false;
  if (points[index].time < OPEN_BELL || points[index].time > OPEN_QUIET_END) return false;
  let open = 0;
  let openAt = -1;
  for (let i = 0; i <= index; i += 1) {
    if (points[i].time < OPEN_BELL || points[i].time > OPEN_QUIET_END) continue;
    if (!Number.isFinite(points[i].price) || !(points[i].price > 0)) continue;
    open = points[i].price;
    openAt = i;
    break;
  }
  if (openAt < 0) return false;
  let earlyHigh = open;
  for (let i = openAt; i <= index; i += 1) {
    if (points[i].time > OPEN_SPIKE_END) break;
    if (points[i].time < OPEN_BELL) continue;
    if (Number.isFinite(points[i].price) && points[i].price > earlyHigh) earlyHigh = points[i].price;
  }
  if (!pairSwingCovers(open, earlyHigh, etf)) return false;
  const spike = earlyHigh - open;
  if (!(spike > 0)) return false;
  return (earlyHigh - points[index].price) / spike >= OPEN_DUMP_RETRACE;
}

function slopeCandidates(points: IntradayMinute[], priorPrices: number[] = []): Candidate[] {
  const prices = points.map((point) => point.price);
  const macd = macdfsSeries(prices, priorPrices);
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

function swingMark(points: IntradayMinute[], index: number, side: "top" | "bottom"): Candidate {
  return {
    index,
    time: points[index].time,
    side,
    price: points[index].price,
    hist: 0,
  };
}

export function intradayExtremes(
  points: IntradayMinute[],
  options?: {
    etf?: boolean;
    openWithSwing?: boolean;
    minConfidence?: number;
    openFirst?: "either" | "bottom";
    belowDailyMa4AndMa7?: boolean;
    priorPrices?: number[];
  },
): IntradayMark[] {
  if (points.length < WINDOW + 2) return [];
  const etf = Boolean(options?.etf);
  const openWithSwing = options?.openWithSwing !== false;
  const minConfidence = options?.minConfidence ?? MIN_MARK_CONFIDENCE;
  const openFirst = options?.openFirst ?? "bottom";
  const marks: Candidate[] = [];
  const state: { seek: "either" | "bottom" | "top" } = { seek: openFirst === "either" ? "either" : "bottom" };
  let openBottom: Candidate | null = null;
  let openTop: Candidate | null = null;
  let topFirst = false;
  const pending = new Map<number, Candidate>();
  for (const candidate of slopeCandidates(points, options?.priorPrices ?? [])) pending.set(candidate.index, candidate);
  let runHigh = -Infinity;
  let runLow = Infinity;
  const quietLast = lastPointFrom(points, OPEN_BELL, OPEN_QUIET_END);
  const openTrap = quietLast >= 0 && isOpenSpikeDump(points, quietLast, etf);

  const closeWithTop = (candidate: Candidate) => {
    openTop = candidate;
    marks.push(candidate);
    state.seek = "bottom";
    openBottom = null;
  };
  const closeWithBottom = (candidate: Candidate) => {
    openBottom = candidate;
    marks.push(candidate);
    state.seek = "top";
    openTop = null;
  };

  for (let i = 0; i < points.length; i += 1) {
    if (points[i].time >= RANGE_START && points[i].time <= RANGE_END && Number.isFinite(points[i].price)) {
      runHigh = Math.max(runHigh, points[i].price);
      runLow = Math.min(runLow, points[i].price);
    }
    const phase = state.seek;
    if (openTrap && points[i].time <= OPEN_QUIET_END) continue;
    const candidate = pending.get(i);
    if (candidate?.side === "top") {
      if (
        phase === "bottom" &&
        openTop &&
        candidate.price > openTop.price &&
        candidate.hist >= openTop.hist * REPLACE_HIST_RATIO
      ) {
        dropMark(marks, openTop);
        openTop = candidate;
        marks.push(candidate);
        continue;
      }
      if (phase === "either") {
        closeWithTop(candidate);
        continue;
      }
      if (phase === "top" && openBottom && pairSwingCovers(openBottom.price, candidate.price, etf)) {
        closeWithTop(candidate);
        continue;
      }
      if (!openBottom && !openTop) {
        topFirst = true;
        continue;
      }
    } else if (candidate?.side === "bottom") {
      if (phase === "top" && openBottom && candidate.price < openBottom.price) {
        dropMark(marks, openBottom);
        openBottom = candidate;
        marks.push(candidate);
        continue;
      }
      if (phase === "either" || (phase === "bottom" && !openBottom)) {
        closeWithBottom(candidate);
        continue;
      }
      if (phase === "bottom" && openTop && pairSwingCovers(candidate.price, openTop.price, etf)) {
        closeWithBottom(candidate);
        continue;
      }
    }

    if (points[i].volume <= 0 || !(points[i].price > 0)) continue;
    if (
      openWithSwing &&
      !openBottom &&
      !openTop &&
      points[i].time >= RANGE_START &&
      pairSwingCovers(runLow, runHigh, etf)
    ) {
      if (points[i].price <= runLow) {
        closeWithBottom(swingMark(points, i, "bottom"));
        continue;
      }
      if (points[i].price >= runHigh) {
        if (phase === "either") {
          closeWithTop(swingMark(points, i, "top"));
          continue;
        }
        topFirst = true;
        continue;
      }
    }
    if (phase === "top" && openBottom && pairSwingCovers(openBottom.price, points[i].price, etf)) {
      closeWithTop(swingMark(points, i, "top"));
      continue;
    }
    if (phase === "bottom" && openTop && pairSwingCovers(points[i].price, openTop.price, etf)) {
      closeWithBottom(swingMark(points, i, "bottom"));
    }
  }

  const range = sessionRangeAfter(points);
  const scored = marks
    .map(({ index, time, side, price }) => {
      const position = positionIndex(price, range);
      return { index, time, side, price, position, confidence: markConfidence(side, position) };
    })
    .filter((mark) => minConfidence <= 0 || (mark.confidence != null && mark.confidence >= minConfidence));
  return withClearExit(points, withForcedSellTop(points, scored), Boolean(options?.belowDailyMa4AndMa7));
}

function lastPointFrom(points: IntradayMinute[], start: string, end: string): number {
  let index = -1;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].time < start || points[i].time > end) continue;
    if (!Number.isFinite(points[i].price) || !(points[i].price > 0)) continue;
    index = i;
  }
  return index;
}

/** 14:45 已到、可见标记只有底没有顶、现价比底高时，用 14:45 到 14:52 的现价补一个卖顶。 */
function withForcedSellTop(points: IntradayMinute[], marks: IntradayMark[]): IntradayMark[] {
  if (!points.some((point) => point.time >= FORCE_TOP_DEADLINE)) return marks;
  if (marks.some((mark) => mark.side === "top") || !marks.some((mark) => mark.side === "bottom")) return marks;
  const lastBottom = [...marks].reverse().find((mark) => mark.side === "bottom");
  if (!lastBottom) return marks;
  const index = lastPointFrom(points, FORCE_TOP_DEADLINE, FORCE_TOP_END);
  if (index < 0 || !(points[index].price > lastBottom.price)) return marks;
  if (marks.some((mark) => mark.index === index && mark.side === "top")) return marks;
  const range = sessionRangeAfter(points);
  const position = positionIndex(points[index].price, range);
  const forced: IntradayMark = {
    index,
    time: points[index].time,
    side: "top",
    price: points[index].price,
    position,
    confidence: markConfidence("top", position),
  };
  return [...marks, forced].sort((a, b) => a.index - b.index);
}

function deadlineIndex(points: IntradayMinute[]): number {
  let after = -1;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].time === CLEAR_EXIT_DEADLINE) return i;
    if (after < 0 && points[i].time >= CLEAR_EXIT_DEADLINE && points[i].time <= RANGE_END) after = i;
  }
  return after;
}

/** 14:50 现价仍低于日线 MA4 和 MA7 时，标清仓离场。不要求先出顶。 */
function withClearExit(
  points: IntradayMinute[],
  marks: IntradayMark[],
  belowDailyMa4AndMa7: boolean,
): IntradayMark[] {
  if (!belowDailyMa4AndMa7) return marks;
  const index = deadlineIndex(points);
  if (index < 0) return marks;
  if (marks.some((mark) => mark.side === "clear" && mark.index === index)) return marks;
  const clear: IntradayMark = {
    index,
    time: points[index].time,
    side: "clear",
    price: points[index].price,
    position: null,
    confidence: null,
  };
  return [...marks, clear].sort((a, b) => a.index - b.index);
}
