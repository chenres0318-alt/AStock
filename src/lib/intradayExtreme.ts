/**
 * 模拟分时顶底。按最近一段 1 分钟的高低位置、动量衰竭和成交量过滤来标。
 * 不是同花顺的公式，标记不会和客户端里的分时顶底一一对应。
 *
 * 顶：价格在这段区间的高位，上涨比前一段慢（或创新高但力度更弱），
 *     高位成交量没有放大，下一分钟向下拐头。
 * 底：价格在这段区间的低位，下跌比前一段慢（或创新低但力度更弱），
 *     低位成交量缩小，下一分钟向上拐头。
 * 这一分钟放量急拉或急跌时不标。标记打在极值那一分钟，要等下一分钟走出来才确认。
 */

const LOOK = 20;
const SPAN = 3;
const POS_HIGH = 0.85;
const POS_LOW = 0.15;
const SLOW = 0.7;
const VOL_BARS = 8;
const TOP_VOL = 1;
const BOTTOM_VOL = 0.9;
const BLOWOFF = 1.6;
const SHARP = 0.3;
const MIN_RANGE = 0.004;
const START = SPAN + VOL_BARS;
/** 同一个拐头上相邻的分钟只留第一次。 */
const MIN_GAP = 5;

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

function windowRange(prices: number[], index: number) {
  let high = prices[index];
  let low = prices[index];
  for (let j = Math.max(0, index - LOOK); j <= index; j += 1) {
    if (prices[j] > high) high = prices[j];
    if (prices[j] < low) low = prices[j];
  }
  return { high, low, span: high - low };
}

function averageVolume(volumes: number[], from: number, to: number) {
  let sum = 0;
  let count = 0;
  for (let j = from; j <= to; j += 1) {
    sum += volumes[j];
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

export function intradayExtremes(points: IntradayMinute[]): IntradayMark[] {
  if (points.length < START + 2) return [];
  const prices = points.map((point) => point.price);
  const volumes = points.map((point) => point.volume);
  const marks: IntradayMark[] = [];
  let lastTop = -MIN_GAP;
  let lastBottom = -MIN_GAP;

  for (let i = START; i < points.length - 1; i += 1) {
    const price = prices[i];
    if (!(price > 0)) continue;
    const { low, span } = windowRange(prices, i);
    if (!(span > 0) || span / price < MIN_RANGE) continue;
    const pos = (price - low) / span;

    const earlierVol = averageVolume(volumes, i - SPAN - VOL_BARS, i - SPAN - 1);
    const recentVol = averageVolume(volumes, i - SPAN + 1, i);
    if (!(earlierVol > 0)) continue;

    const recent = price - prices[i - SPAN];
    const prior = prices[i - SPAN] - prices[i - 2 * SPAN];
    let peak = Math.max(SPAN, i - LOOK);
    let trough = peak;
    for (let j = peak + 1; j <= i - SPAN - 1; j += 1) {
      if (prices[j] >= prices[peak]) peak = j;
      if (prices[j] <= prices[trough]) trough = j;
    }
    const peakPush = prices[peak] - prices[peak - SPAN];
    const troughDrop = prices[trough - SPAN] - prices[trough];
    const step = price - prices[i - 1];
    const blowoff = volumes[i] >= earlierVol * BLOWOFF && Math.abs(step) >= span * SHARP;

    const upSlowed = prior > 0 && recent < prior * SLOW;
    const newHighWeaker = price >= prices[peak] && peakPush > 0 && recent < peakPush;
    const downSlowed = prior < 0 && recent > prior * SLOW;
    const newLowWeaker = price <= prices[trough] && troughDrop > 0 && -recent < troughDrop;

    const localHigh = price >= prices[i - 1] && price >= prices[i - 2];
    const localLow = price <= prices[i - 1] && price <= prices[i - 2];

    if (
      i - lastTop >= MIN_GAP &&
      pos >= POS_HIGH &&
      localHigh &&
      prices[i + 1] < price &&
      (upSlowed || newHighWeaker) &&
      recentVol <= earlierVol * TOP_VOL &&
      !blowoff
    ) {
      marks.push({ index: i, time: points[i].time, side: "top", price });
      lastTop = i;
      continue;
    }

    if (
      i - lastBottom >= MIN_GAP &&
      pos <= POS_LOW &&
      localLow &&
      prices[i + 1] > price &&
      (downSlowed || newLowWeaker) &&
      recentVol <= earlierVol * BOTTOM_VOL &&
      !blowoff
    ) {
      marks.push({ index: i, time: points[i].time, side: "bottom", price });
      lastBottom = i;
    }
  }
  return marks;
}
