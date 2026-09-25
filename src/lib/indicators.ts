import type { KBar } from "./types";

export type MacdPoint = {
  dif: number;
  dea: number;
  hist: number;
};

export type ScreenFlags = {
  close: number;
  open: number;
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
  macdBull: boolean;
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
/** 相对持仓成本每上涨或下跌这一档，标一次减仓或加仓。 */
const REDUCE_STEP = 0.07;
/** 减仓之后，收盘相对上一次减仓价再跌超过这一档，才标下一次加仓。 */
const ADD_AFTER_REDUCE = 0.08;
/** 20 日线下方的空头减弱，只保留大阳 / 大振幅反包，避免下跌中继假买点。 */
const STRONG_RECLAIM_DAY_PCT = 5;
const STRONG_RECLAIM_AMP_PCT = 8;

/** DIF 上一根还在 DEA 上（含相等），这一根落到 DEA 下。 */
function macdDeathCross(series: Array<MacdPoint | null>, index: number): boolean {
  const prev = series[index - 1];
  const cur = series[index];
  if (!prev || !cur) return false;
  return prev.dif + 1e-8 >= prev.dea && cur.dif < cur.dea;
}

/** 这根或向前 window-1 根里，有过一次近 5 日首次站上五日线。 */
function recentFirstStand(closes: number[], i: number, window = FIRST_STAND_LOOK): boolean {
  const from = Math.max(0, i - (window - 1));
  for (let j = from; j <= i; j += 1) {
    if (firstStandAboveMa5(closes, j)) return true;
  }
  return false;
}

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
  const ma5 = maAt(closes, 5, i);
  const ma5Prev = maAt(closes, 5, i - 1);
  if (ma5 == null || ma5Prev == null) return null;

  const aboveMa5 = closes[i] > ma5;
  const firstStandMa5 = firstStandAboveMa5(closes, i);

  const cur = macd[i];
  const prev = macd[i - 1];
  const macdBull = Boolean(cur && cur.dea > 0 && cur.dif + 1e-8 >= cur.dea);
  const macdBearWeak = Boolean(
    cur &&
      prev &&
      !(cur.dea > 0 && cur.dif + 1e-8 >= cur.dea) &&
      cur.hist > prev.hist &&
      (cur.hist < 0 || cur.dea <= 0 || cur.dif <= 0),
  );

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
  if (tech.firstStandMa5) rows.push("近5日首次站上五日线");
  if (tech.macdBull) rows.push("MACD多头排列");
  else if (tech.macdBearWeak) rows.push("MACD空头减弱");
  if (tech.macdBearWeak && tech.belowMa20 && tech.strongReclaim) rows.push("大阳反包");
  return rows;
}

export function passesScreen(tech: ScreenFlags): boolean {
  if (!tech.firstStandMa5) return false;
  if (tech.macdBull) return true;
  if (!tech.macdBearWeak) return false;
  // 20 日线下方的空头减弱，多数是下跌中继；只留下大阳 / 大振幅反包。
  if (tech.belowMa20 && !tech.strongReclaim) return false;
  return true;
}

/** 通达信 EMA：首值取当天，之后 Y = 2/(N+1)*X + (N-1)/(N+1)*Y'。 */
function tdxEma(values: number[], period: number): number[] {
  const out: number[] = [];
  if (values.length === 0) return out;
  const alpha = 2 / (period + 1);
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out.push(prev);
  }
  return out;
}

const RIBBON_LAYERS = 7;
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

export type RibbonPoint = {
  time: string;
  values: number[];
  /** 相对前一根。首根或与前一根相等时为 null。 */
  direction: Array<"up" | "down" | null>;
};

export type RibbonSignal = {
  time: string;
  side: "buy" | "add" | "reduce" | "clear";
  close: number;
  /** 触发这笔信号的涨跌幅。成本档加减仓和清仓相对当时持仓成本；减仓后的加仓相对上一次减仓收盘。加仓为负，减仓为正。 */
  gain: number | null;
};

/**
 * 通达信起涨红丝带。
 * VAR1=(2*C+H+L+O)/5
 * A1=(EMA(VAR1,3)+EMA(VAR1,6)+EMA(VAR1,12)+EMA(VAR1,24))/4
 * A2..A7 逐层 EMA(2)
 * 买：七层刚变成全红，并且这根或前 4 根里出现过近 5 日首次站上五日线。
 * 丝带慢于价格，首次站上往往早于七层全部翻红，所以买点落在翻红这根。
 * 加仓 / 减仓：成本是买入价和其后各次加仓价的等权平均，减仓不改变成本。
 * 收盘相对这个成本每下跌 7% 标一次加仓，每上涨 7% 标一次减仓。加仓后按新成本重新分档。
 * 减仓之后，要先相对上一次减仓收盘再跌超过 8%，才标下一次加仓；这次加仓仍计入成本。
 * 买入之后，DIF 下穿 DEA 为 MACD 死叉，标一次清仓并结束这笔持仓，直到下一次买入。
 */
export function buildRedRibbon(bars: KBar[]): { points: RibbonPoint[]; signals: RibbonSignal[] } {
  const points: RibbonPoint[] = [];
  const signals: RibbonSignal[] = [];
  if (bars.length === 0) return { points, signals };
  const var1 = bars.map((bar) => (2 * bar.close + bar.high + bar.low + bar.open) / 5);
  const ema3 = tdxEma(var1, 3);
  const ema6 = tdxEma(var1, 6);
  const ema12 = tdxEma(var1, 12);
  const ema24 = tdxEma(var1, 24);
  const a1 = var1.map((_, i) => (ema3[i] + ema6[i] + ema12[i] + ema24[i]) / 4);
  const layers: number[][] = [a1];
  for (let layer = 1; layer < RIBBON_LAYERS; layer += 1) layers.push(tdxEma(layers[layer - 1], 2));
  const allRising: boolean[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const direction: Array<"up" | "down" | null> = [];
    for (let layer = 0; layer < RIBBON_LAYERS; layer += 1) {
      if (i === 0 || layers[layer][i] === layers[layer][i - 1]) direction.push(null);
      else direction.push(layers[layer][i] > layers[layer][i - 1] ? "up" : "down");
    }
    allRising.push(direction.every((item) => item === "up"));
    points.push({
      time: bars[i].time,
      values: layers.map((layer) => layer[i]),
      direction,
    });
  }

  const closes = bars.map((bar) => bar.close);
  const macd = macdSeries(closes);
  let cost: number | null = null;
  let units = 0;
  let reduceSteps = 0;
  let addSteps = 0;
  let lastReduceClose: number | null = null;
  const takeAdd = (index: number, gain: number) => {
    signals.push({ time: bars[index].time, side: "add", close: bars[index].close, gain });
    cost = ((cost as number) * units + closes[index]) / (units + 1);
    units += 1;
    addSteps = 0;
    reduceSteps = 0;
    lastReduceClose = null;
  };
  for (let i = 1; i < bars.length; i += 1) {
    const turnedUp = allRising[i] && !allRising[i - 1];
    const bought = turnedUp && recentFirstStand(closes, i);
    if (bought) {
      signals.push({ time: bars[i].time, side: "buy", close: bars[i].close, gain: null });
      cost = bars[i].close;
      units = 1;
      reduceSteps = 0;
      addSteps = 0;
      lastReduceClose = null;
    }
    if (cost != null && cost > 0 && units > 0 && !bought && macdDeathCross(macd, i)) {
      signals.push({ time: bars[i].time, side: "clear", close: bars[i].close, gain: closes[i] / cost - 1 });
      cost = null;
      units = 0;
      reduceSteps = 0;
      addSteps = 0;
      lastReduceClose = null;
    } else if (cost != null && cost > 0 && units > 0 && !bought) {
      const gain = closes[i] / cost - 1;
      const fromReduce = lastReduceClose != null && lastReduceClose > 0 ? closes[i] / lastReduceClose - 1 : null;
      if (fromReduce != null && fromReduce < -ADD_AFTER_REDUCE) {
        takeAdd(i, fromReduce);
      } else if (fromReduce != null && fromReduce < 0) {
        // 减仓后的回撤还没超过 8%，先不加仓。
      } else if (gain < 0) {
        const steps = Math.floor((-gain + 1e-9) / REDUCE_STEP);
        if (steps > addSteps) takeAdd(i, gain);
      } else if (gain > 0) {
        const steps = Math.floor((gain + 1e-9) / REDUCE_STEP);
        if (steps > reduceSteps) {
          signals.push({ time: bars[i].time, side: "reduce", close: bars[i].close, gain });
          reduceSteps = steps;
          lastReduceClose = closes[i];
        }
      }
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
