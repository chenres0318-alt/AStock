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
  side: "buy" | "sell";
  close: number;
  gain: number | null;
};

/**
 * 通达信起涨红丝带。
 * VAR1=(2*C+H+L+O)/5
 * A1=(EMA(VAR1,3)+EMA(VAR1,6)+EMA(VAR1,12)+EMA(VAR1,24))/4
 * A2..A7 逐层 EMA(2)
 * 买：下跌中的青丝带逐步收拢且五日线向上；或者青丝带里已有层转红，同时五日线拐向上。
 * 红丝带收拢卖出，或红丝带里有层转青并且五日线拐向下卖出之后，若五日线重新拐向上且红丝带又向上发散，再标买。
 * 卖：青丝带又向下发散且五日线拐头向下；红丝带收拢且五日线拐头向下；或者红丝带里已有层转青，同时五日线拐向下。
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
  for (let i = 0; i < bars.length; i += 1) {
    const direction: Array<"up" | "down" | null> = [];
    for (let layer = 0; layer < RIBBON_LAYERS; layer += 1) {
      if (i === 0 || layers[layer][i] === layers[layer][i - 1]) direction.push(null);
      else direction.push(layers[layer][i] > layers[layer][i - 1] ? "up" : "down");
    }
    points.push({
      time: bars[i].time,
      values: layers.map((layer) => layer[i]),
      direction,
    });
  }

  const closes = bars.map((bar) => bar.close);
  const spreadAt = (index: number) => {
    const values = points[index].values;
    return Math.max(...values) - Math.min(...values);
  };
  let holding = false;
  let reboundBuy = false;
  let sawHookUp = false;
  for (let i = 6; i < bars.length; i += 1) {
    const direction = points[i].direction;
    const allUp = direction.every((item) => item === "up");
    const allDown = direction.every((item) => item === "down");
    const spread = spreadAt(i);
    const spreadPrev = spreadAt(i - 1);
    const spreadPrev2 = spreadAt(i - 2);
    const narrowingStep = spread < spreadPrev && spreadPrev < spreadPrev2;
    const narrowing = spread < spreadPrev;
    const widening = spread > spreadPrev && spread > spreadPrev2;
    const lowerFalling = Math.min(...points[i].values) < Math.min(...points[i - 1].values);
    const ma5 = maAt(closes, 5, i);
    const ma5Prev = maAt(closes, 5, i - 1);
    const ma5Prev2 = maAt(closes, 5, i - 2);
    if (ma5 == null || ma5Prev == null || ma5Prev2 == null) continue;
    const maRising = ma5 > ma5Prev;
    const maTurningUp = maRising && ma5Prev <= ma5Prev2;
    const maTurningDown = ma5 < ma5Prev && ma5Prev >= ma5Prev2;
    const allOf = (index: number, side: "up" | "down") => points[index].direction.every((item) => item === side);
    const cameFrom = (side: "up" | "down") => {
      const other = side === "up" ? "down" : "up";
      for (let j = i - 1; j >= Math.max(1, i - 8); j -= 1) {
        if (allOf(j, other)) return false;
        if (allOf(j, side)) return true;
      }
      return false;
    };
    const someUp = direction.some((item) => item === "up");
    const someDown = direction.some((item) => item === "down");
    const buyOnConverge = allDown && narrowingStep && maRising;
    const buyOnTurningRed = !allDown && someUp && cameFrom("down") && maTurningUp;
    const sellOnCyanDiverge = allDown && widening && lowerFalling && maTurningDown;
    const sellOnRedContract = allUp && narrowing && maTurningDown;
    const sellOnTurningCyan = !allUp && someDown && cameFrom("up") && maTurningDown;
    const upperRising = Math.max(...points[i].values) > Math.max(...points[i - 1].values);
    const divergingUp = allUp && spread > spreadPrev && upperRising;
    if (holding && (sellOnCyanDiverge || sellOnRedContract || sellOnTurningCyan)) {
      signals.push({ time: bars[i].time, side: "sell", close: bars[i].close, gain: null });
      holding = false;
      reboundBuy = sellOnRedContract || sellOnTurningCyan;
      sawHookUp = false;
    } else if (!holding) {
      if (reboundBuy && maTurningUp) sawHookUp = true;
      const reboundReady = reboundBuy && sawHookUp && divergingUp && maRising;
      if (reboundBuy && (allDown || (sawHookUp && maTurningDown && !reboundReady))) {
        reboundBuy = false;
        sawHookUp = false;
      }
      if (reboundReady && reboundBuy) {
        signals.push({ time: bars[i].time, side: "buy", close: bars[i].close, gain: null });
        holding = true;
        reboundBuy = false;
        sawHookUp = false;
      } else if (buyOnConverge || buyOnTurningRed) {
        signals.push({ time: bars[i].time, side: "buy", close: bars[i].close, gain: null });
        holding = true;
        reboundBuy = false;
        sawHookUp = false;
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
