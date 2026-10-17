/**
 * 用分时 MACDFS(12,26,9) 标出 DIF、DEA 连续三分钟的拐头。不是同花顺的公式。
 * 柱 = 2 * (DIF - DEA)。红柱是 DIF > DEA，绿柱是 DEA > DIF。
 *
 * 顶：处在 DIF > DEA。DEA 连续三分钟放大，红柱动能连续三分钟减弱，
 *     DIF 已经拐头向下、靠近 DEA。DIF 不必先缩满三分钟，下叉前这一分钟就算顶。
 * 底：处在 DEA > DIF。DEA 连续三分钟缩小，DIF 这一分钟已经拐头向上、缺口在收，
 *     绿柱动能连续三分钟减弱，这一分钟还没上叉。
 * 同一段连续满足时只标第一分钟。之后顶和底交替。
 * 还没配上对面时，更高的顶要红柱不低于前一个顶的八成才换掉；更低的底直接换掉前一个底。
 * 配成一对时，股票一手差价要盖过 5 元最低佣金，再加卖出一手的 0.05% 印花税。
 * ETF 免 5 元最低佣金，只看印花税。
 */

const LOT = 100;
const COMMISSION = 5;
const STAMP_RATE = 0.0005;
/** 缩小或放大要连续这么多分钟。 */
const SLOPE_BARS = 3;
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

/** 一手买卖的差价，要多于最低佣金加卖出一手的印花税。ETF 把最低佣金传 0。 */
export function lotSpreadCoversCost(low: number, high: number, minCommission = COMMISSION): boolean {
  if (!(high > low)) return false;
  const spread = (high - low) * LOT;
  const stamp = high * LOT * STAMP_RATE;
  return spread > minCommission + stamp;
}

function strictlyDown(values: number[], index: number): boolean {
  for (let step = 0; step < SLOPE_BARS; step += 1) {
    if (!(values[index - step] < values[index - step - 1])) return false;
  }
  return true;
}

function strictlyUp(values: number[], index: number): boolean {
  for (let step = 0; step < SLOPE_BARS; step += 1) {
    if (!(values[index - step] > values[index - step - 1])) return false;
  }
  return true;
}

function slopeCandidates(points: IntradayMinute[]): Candidate[] {
  const macd = macdfsSeries(points.map((point) => point.price));
  const dif = macd.map((bar) => bar?.dif ?? Number.NaN);
  const dea = macd.map((bar) => bar?.dea ?? Number.NaN);
  const hist = macd.map((bar) => bar?.hist ?? Number.NaN);
  const candidates: Candidate[] = [];
  let lastSide: "top" | "bottom" | null = null;
  let lastIndex = -1;

  for (let i = SLOPE_BARS; i < points.length; i += 1) {
    if (!macd[i] || !macd[i - SLOPE_BARS]) continue;
    const redZone = dif[i] > dea[i] && dif[i - 1] > dea[i - 1] && dif[i - 2] > dea[i - 2];
    const greenZone = dea[i] > dif[i] && dea[i - 1] > dif[i - 1] && dea[i - 2] > dif[i - 2];
    let side: "top" | "bottom" | null = null;
    if (redZone && strictlyUp(dea, i) && strictlyDown(hist, i) && dif[i] < dif[i - 1]) {
      side = "top";
    } else if (
      greenZone &&
      strictlyDown(dea, i) &&
      dif[i] > dif[i - 1] &&
      dea[i] - dif[i] < dea[i - 1] - dif[i - 1] &&
      strictlyUp(hist, i)
    ) {
      side = "bottom";
    }
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
  if (points.length < SLOPE_BARS + 1) return [];
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
