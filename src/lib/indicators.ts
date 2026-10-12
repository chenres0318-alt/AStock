import type { KBar } from "./types";

export type MacdPoint = {
  dif: number;
  dea: number;
  hist: number;
};

export type ScreenFlags = {
  close: number;
  open: number;
  ma4: number;
  ma7: number;
  ma5: number;
  ma5Prev: number;
  ma20: number | null;
  dif: number;
  dea: number;
  hist: number;
  dayPct: number | null;
  amplitudePct: number | null;
  aboveMa5: boolean;
  firstStandMa5: boolean;
  ma4CrossUpMa7: boolean;
  macdBull: boolean;
  /** MACD 柱仍为负，且比前一日更接近 0，绿柱缩短。 */
  macdBearWeak: boolean;
  belowMa20: boolean;
  strongReclaim: boolean;
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

const FIRST_STAND_LOOK = 5;
/** 20 日线下方的空头减弱，只保留大阳 / 大振幅反包，避免下跌中继假买点。 */
const STRONG_RECLAIM_DAY_PCT = 5;
const STRONG_RECLAIM_AMP_PCT = 8;

/** 收盘站上五日线，且向前 look-1 根都没有站上。 */
export function firstStandAboveMa5(closes: number[], i: number, look = FIRST_STAND_LOOK): boolean {
  const ma5 = maAt(closes, 5, i);
  if (ma5 == null || !(closes[i] > ma5)) return false;
  for (let j = i - (look - 1); j < i; j += 1) {
    const ma = maAt(closes, 5, j);
    if (ma == null || closes[j] > ma) return false;
  }
  return true;
}

export function analyzeBarsAt(
  bars: KBar[],
  i: number,
  closes = bars.map((bar) => bar.close),
  macd = macdSeries(closes),
): ScreenFlags | null {
  if (i < FIRST_STAND_LOOK + 3 || i >= bars.length) return null;
  const ma4 = maAt(closes, 4, i);
  const ma4Prev = maAt(closes, 4, i - 1);
  const ma7 = maAt(closes, 7, i);
  const ma7Prev = maAt(closes, 7, i - 1);
  const ma5 = maAt(closes, 5, i);
  const ma5Prev = maAt(closes, 5, i - 1);
  if (ma4 == null || ma4Prev == null || ma7 == null || ma7Prev == null || ma5 == null || ma5Prev == null) return null;

  const aboveMa5 = closes[i] > ma5;
  const firstStandMa5 = firstStandAboveMa5(closes, i);
  const ma4CrossUpMa7 = ma4Prev <= ma7Prev && ma4 > ma7;

  const cur = macd[i];
  const prev = macd[i - 1];
  const macdBull = Boolean(cur && cur.dea > 0 && cur.dif + 1e-8 >= cur.dea);
  const macdBearWeak = Boolean(cur && prev && cur.hist < 0 && cur.hist > prev.hist);

  const prevClose = bars[i - 1].close;
  const dayPct = prevClose > 0 ? ((bars[i].close / prevClose - 1) * 100) : null;
  const amplitudePct = prevClose > 0 ? ((bars[i].high - bars[i].low) / prevClose) * 100 : null;
  const ma20 = maAt(closes, 20, i);
  const belowMa20 = ma20 != null && closes[i] < ma20;
  const strongReclaim = Boolean(
    closes[i] >= bars[i].open &&
      ((dayPct != null && dayPct >= STRONG_RECLAIM_DAY_PCT) ||
        (amplitudePct != null && amplitudePct >= STRONG_RECLAIM_AMP_PCT)),
  );

  return {
    close: bars[i].close,
    open: bars[i].open,
    ma4,
    ma7,
    ma5,
    ma5Prev,
    ma20,
    dif: cur?.dif ?? 0,
    dea: cur?.dea ?? 0,
    hist: cur?.hist ?? 0,
    dayPct,
    amplitudePct,
    aboveMa5,
    firstStandMa5,
    ma4CrossUpMa7,
    macdBull,
    macdBearWeak,
    belowMa20,
    strongReclaim,
  };
}

export function analyzeBars(bars: KBar[]): ScreenFlags | null {
  if (bars.length < 40) return null;
  const closes = bars.map((bar) => bar.close);
  return analyzeBarsAt(bars, bars.length - 1, closes, macdSeries(closes));
}

export type BuyPoint = {
  time: string;
  close: number;
};

export type TdMark<T = string> = {
  time: T;
  count: number;
  side: "up" | "down";
};

/**
 * TD Setup。新的一段必须先出现价格翻转（本根相对 4 根前的方向，和前一根相反），
 * 然后连续 9 根都满足才保留 1–9。中途断开的整段丢掉。数满 9 后不再顺延重计，
 * 要等下一次翻转。正在走的一段从 1 就开始标，方便当天看到翻转；
 * 没走完的历史段不保留，避免事后看起来每个 1 都成功。
 */
export function tdSequential<T>(points: Array<{ time: T; close: number }>): Array<TdMark<T>> {
  const completed: Array<TdMark<T>> = [];
  let active: Array<TdMark<T>> | null = null;

  for (let i = 4; i < points.length; i += 1) {
    const close = points[i].close;
    const up = close > points[i - 4].close;
    const down = close < points[i - 4].close;
    let bearishFlip = up;
    let bullishFlip = down;
    if (i >= 5) {
      const prevUp = points[i - 1].close > points[i - 5].close;
      const prevDown = points[i - 1].close < points[i - 5].close;
      bearishFlip = up && !prevUp;
      bullishFlip = down && !prevDown;
    }

    if (active) {
      const side = active[0].side;
      const keeps = side === "up" ? up : down;
      if (keeps && active.length < 9) {
        active.push({ time: points[i].time, count: active.length + 1, side });
        if (active.length === 9) {
          completed.push(...active);
          active = null;
        }
        continue;
      }
      active = null;
    }

    if (bearishFlip) active = [{ time: points[i].time, count: 1, side: "up" }];
    else if (bullishFlip) active = [{ time: points[i].time, count: 1, side: "down" }];
  }

  return active ? completed.concat(active) : completed;
}

const VOLUME_BOOST = 1.15;
const MAX_DAY_PCT = 8;
const ATR_MIN = 0.02;
const ATR_MAX = 0.05;

function trueRange(bars: KBar[], index: number): number {
  const prevClose = bars[index - 1].close;
  const bar = bars[index];
  return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
}

function atr14(bars: KBar[], index: number): number | null {
  if (index < 14) return null;
  let sum = 0;
  for (let j = index - 13; j <= index; j += 1) sum += trueRange(bars, j);
  return sum / 14;
}

/** 趋势波段买点。日线：收盘站上 30 日线，开盘还在昨日 30 日线压力之下。 */
export function findTrendSwingBuys(bars: KBar[]): BuyPoint[] {
  const points: BuyPoint[] = [];
  if (bars.length < 40) return points;
  const closes = bars.map((bar) => bar.close);
  const macd = macdSeries(closes);
  for (let i = 33; i < bars.length; i += 1) {
    const ma30 = maAt(closes, 30, i);
    const ma30Prev = maAt(closes, 30, i - 1);
    const cur = macd[i];
    const atr = atr14(bars, i);
    if (ma30 == null || ma30Prev == null || cur == null || atr == null) continue;
    const bar = bars[i];
    const prevClose = bars[i - 1].close;
    if (!(prevClose > 0) || !(bar.close > ma30) || !(bar.open <= ma30Prev)) continue;
    const dayPct = (bar.close / prevClose - 1) * 100;
    if (!(dayPct < MAX_DAY_PCT)) continue;
    let volSum = 0;
    for (let j = i - 5; j < i; j += 1) volSum += bars[j].volume;
    const volAvg = volSum / 5;
    if (!(volAvg > 0) || !(bar.volume >= volAvg * VOLUME_BOOST)) continue;
    if (!(cur.dif + 1e-8 >= cur.dea)) continue;
    const atrPct = atr / bar.close;
    if (!(atrPct >= ATR_MIN && atrPct <= ATR_MAX)) continue;
    if (bar.mainNet == null || !(bar.mainNet >= 0)) continue;
    points.push({ time: bar.time, close: bar.close });
  }
  return points;
}

export function findBuyPoints(bars: KBar[]): BuyPoint[] {
  const points: BuyPoint[] = [];
  if (bars.length < 40) return points;
  const closes = bars.map((bar) => bar.close);
  const macd = macdSeries(closes);
  for (let i = 33; i < bars.length; i += 1) {
    const tech = analyzeBarsAt(bars, i, closes, macd);
    if (!tech || !passesScreen(tech)) continue;
    points.push({ time: bars[i].time, close: bars[i].close });
  }
  return points;
}

export function screenReasons(tech: ScreenFlags): string[] {
  const rows: string[] = [];
  if (tech.ma4CrossUpMa7) rows.push("4日均线上穿7日均线");
  if (tech.macdBearWeak) rows.push("MACD空头势力减弱");
  return rows;
}

/** 当天收盘：4 日均线上穿 7 日均线，且 MACD 绿柱缩短但仍为负。 */
export function passesScreen(tech: ScreenFlags): boolean {
  return tech.ma4CrossUpMa7 && tech.macdBearWeak;
}

const ADX_PERIOD = 14;

function wilderSmooth(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** 14 日 ADX，Wilder 平滑。下标与 K 线对齐，前期不足时为 null。 */
export function adxSeries(bars: KBar[], period = ADX_PERIOD): Array<number | null> {
  const out: Array<number | null> = Array(bars.length).fill(null);
  if (bars.length < period * 2 + 1) return out;
  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i];
    const prev = bars[i - 1];
    tr.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close)));
    const upMove = bar.high - prev.high;
    const downMove = prev.low - bar.low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smoothTr = wilderSmooth(tr, period);
  const smoothPlus = wilderSmooth(plusDm, period);
  const smoothMinus = wilderSmooth(minusDm, period);
  const dx: number[] = [];
  for (let j = period - 1; j < tr.length; j += 1) {
    const trValue = smoothTr[j];
    const plus = smoothPlus[j];
    const minus = smoothMinus[j];
    if (trValue == null || plus == null || minus == null || !(trValue > 0)) {
      dx.push(0);
      continue;
    }
    const pdi = (100 * plus) / trValue;
    const mdi = (100 * minus) / trValue;
    const denom = pdi + mdi;
    dx.push(denom > 0 ? (100 * Math.abs(pdi - mdi)) / denom : 0);
  }
  const adx = wilderSmooth(dx, period);
  const dxStart = period - 1;
  for (let k = 0; k < dx.length; k += 1) {
    if (adx[k] == null) continue;
    out[dxStart + k + 1] = adx[k];
  }
  return out;
}

export type MaLinePoint = {
  time: string;
  ma4: number | null;
  ma7: number | null;
  ma20: number | null;
};

export type RibbonSignal = {
  time: string;
  side: "buy" | "sell";
  close: number;
  gain: number | null;
};

export type MaSignalRule = "ma20" | "day";

/**
 * K 线叠加 4 / 7 / 20 日收盘均线。
 * day：日线买卖。买是 4 日上穿 7 日且 MACD 绿柱缩短；卖是 4 日下穿 7 日。
 * ma20：周、月线仍用收盘站上 20 日才买，跌破 20 日或 4 日下穿 7 日卖。
 */
export function buildMaLines(
  bars: KBar[],
  rule: MaSignalRule = "ma20",
): { points: MaLinePoint[]; signals: RibbonSignal[] } {
  const closes = bars.map((bar) => bar.close);
  const points: MaLinePoint[] = bars.map((bar, i) => ({
    time: bar.time,
    ma4: maAt(closes, 4, i),
    ma7: maAt(closes, 7, i),
    ma20: maAt(closes, 20, i),
  }));
  const macd = rule === "day" ? macdSeries(closes) : null;
  const signals: RibbonSignal[] = [];
  let holding = false;
  for (let i = 1; i < bars.length; i += 1) {
    const cur = points[i];
    const prev = points[i - 1];
    if (cur.ma4 == null || cur.ma7 == null || prev.ma4 == null || prev.ma7 == null) continue;
    if (rule === "ma20" && cur.ma20 == null) continue;
    const crossUp = prev.ma4 <= prev.ma7 && cur.ma4 > cur.ma7;
    const crossDown = prev.ma4 >= prev.ma7 && cur.ma4 < cur.ma7;
    const hist = macd?.[i];
    const histPrev = macd?.[i - 1];
    const bearWeak = Boolean(hist && histPrev && hist.hist < 0 && hist.hist > histPrev.hist);
    const buy = rule === "day" ? crossUp && bearWeak : crossUp && closes[i] > (cur.ma20 as number);
    const sell = rule === "day" ? crossDown : crossDown || closes[i] < (cur.ma20 as number);
    if (holding && sell) {
      signals.push({ time: bars[i].time, side: "sell", close: closes[i], gain: null });
      holding = false;
    } else if (!holding && buy) {
      signals.push({ time: bars[i].time, side: "buy", close: closes[i], gain: null });
      holding = true;
    }
  }
  return { points, signals };
}

/** 区间涨跌：起点收盘到终点收盘。from / to 顺序不限。 */
export function klineRangeChange(bars: KBar[], from: string, to: string) {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const slice = bars.filter((bar) => bar.time >= start && bar.time <= end);
  if (slice.length === 0 || !(slice[0].close > 0)) return null;
  const first = slice[0];
  const last = slice[slice.length - 1];
  return {
    from: first.time,
    to: last.time,
    start: first.close,
    end: last.close,
    change: last.close - first.close,
    pct: last.close / first.close - 1,
    count: slice.length,
  };
}
