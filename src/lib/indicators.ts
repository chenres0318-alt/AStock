import type { KBar } from "./types";

export type MacdPoint = {
  dif: number;
  dea: number;
  hist: number;
};

export type BuySetupFlags = {
  close: number;
  open: number;
  ma5: number;
  ma10: number;
  ma5Prev: number;
  dif: number;
  dea: number;
  hist: number;
  histPrev: number;
  histPrev2: number;
  dayPct: number | null;
  yangPct: number | null;
  threeDayPct: number | null;
  pullbackPct: number | null;
  aboveMa5: boolean;
  reclaimMa5: boolean;
  opensMas: boolean;
  strongYang: boolean;
  nearLimit: boolean;
  macdTurning: boolean;
  holdsFloor: boolean;
  bottomShrinkVol: boolean;
  launchVolNotClimax: boolean;
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

function minRange(bars: KBar[], from: number, to: number, pick: (bar: KBar) => number): { value: number; index: number } {
  let value = Number.POSITIVE_INFINITY;
  let index = from;
  for (let j = from; j <= to; j += 1) {
    const next = pick(bars[j]);
    if (next < value) {
      value = next;
      index = j;
    }
  }
  return { value, index };
}

function maxRange(bars: KBar[], from: number, to: number, pick: (bar: KBar) => number): number {
  let value = 0;
  for (let j = from; j <= to; j += 1) value = Math.max(value, pick(bars[j]));
  return value;
}

export function analyzeBars(bars: KBar[], limitPct = 10): BuySetupFlags | null {
  if (bars.length < 50) return null;
  const i = bars.length - 1;
  const closes = bars.map((bar) => bar.close);
  const ma5 = maAt(closes, 5, i);
  const ma5Prev = maAt(closes, 5, i - 1);
  const ma10 = maAt(closes, 10, i);
  const macd = macdSeries(closes);
  const cur = macd[i];
  const prev = macd[i - 1];
  const prev2 = macd[i - 2];
  if (ma5 == null || ma5Prev == null || ma10 == null || !cur || !prev || !prev2) return null;

  const prevClose = bars[i - 1].close;
  const dayPct = prevClose > 0 ? ((bars[i].close / prevClose - 1) * 100) : null;
  const yangPct = prevClose > 0 ? ((bars[i].close - bars[i].open) / prevClose * 100) : null;
  const threeDayPct =
    closes.length >= 4 && closes[i - 3] > 0 ? ((closes[i] / closes[i - 3] - 1) * 100) : null;

  const highStart = Math.max(0, i - 24);
  const highEnd = Math.max(highStart, i - 3);
  let peakIdx = highStart;
  let peakHigh = bars[highStart].high;
  for (let j = highStart; j <= highEnd; j += 1) {
    if (bars[j].high >= peakHigh) {
      peakHigh = bars[j].high;
      peakIdx = j;
    }
  }

  let swingIdx = -1;
  let swingLow = Number.POSITIVE_INFINITY;
  for (let j = peakIdx + 1; j <= i - 1; j += 1) {
    const isTrough = bars[j].low <= bars[j - 1].low && (j === i - 1 || bars[j].low <= bars[j + 1].low);
    if (!isTrough) continue;
    if (peakHigh <= 0 || (peakHigh - bars[j].low) / peakHigh < 0.08) continue;
    const bounceEnd = Math.min(i, j + 5);
    let bounceHigh = 0;
    for (let k = j + 1; k <= bounceEnd; k += 1) bounceHigh = Math.max(bounceHigh, bars[k].high);
    if (bounceHigh < bars[j].low * 1.03) continue;
    swingIdx = j;
    swingLow = bars[j].low;
    break;
  }
  if (swingIdx < 0) {
    const fallbackEnd = Math.max(peakIdx, i - 2);
    const swing = minRange(bars, peakIdx, fallbackEnd, (bar) => bar.low);
    swingIdx = swing.index;
    swingLow = swing.value;
  }

  let secondLow = Number.POSITIVE_INFINITY;
  let foundSecond = false;
  for (let j = swingIdx + 2; j < i; j += 1) {
    const left = bars[j].low <= bars[j - 1].low;
    const right = j + 1 >= i ? true : bars[j].low <= bars[j + 1].low;
    if (!left || !right) continue;
    foundSecond = true;
    secondLow = Math.min(secondLow, bars[j].low);
  }
  const holdsFloor =
    Number.isFinite(swingLow) &&
    bars[i].low >= swingLow * 0.985 &&
    (!foundSecond || secondLow >= swingLow * 0.985);

  const pullbackPct = peakHigh > 0 && Number.isFinite(swingLow) ? ((peakHigh - swingLow) / peakHigh) * 100 : null;

  let belowMa5 = 0;
  for (let j = Math.max(4, i - 10); j < i; j += 1) {
    const ma = maAt(closes, 5, j);
    if (ma != null && closes[j] < ma) belowMa5 += 1;
  }
  const reclaimMa5 = closes[i] > ma5 && belowMa5 >= 1;
  const opensMas = ma5 >= ma10 || (ma5 > ma5Prev && closes[i] > ma10);
  const nearLimit = dayPct != null && dayPct >= limitPct - 0.6;
  const strongYang = nearLimit || (dayPct != null && dayPct >= 3) || (yangPct != null && yangPct >= 2.8);

  const recentMacd = macd.slice(Math.max(0, i - 7), i + 1);
  const wasGreen = recentMacd.some((item) => item != null && item.hist < 0);
  const macdTurning = wasGreen && cur.hist > prev.hist;

  const panicStart = Math.max(0, swingIdx - 8);
  const panicVol = maxRange(bars, panicStart, swingIdx, (bar) => bar.volume);
  const neighbor = Math.min(i, swingIdx + 1);
  const bottomVol = Math.min(bars[swingIdx].volume, bars[neighbor].volume);
  const bottomShrinkVol = panicVol > 0 && bottomVol <= panicVol * 0.9;

  const volStart = Math.max(0, i - 12);
  const priorMaxVol = volStart < i ? maxRange(bars, volStart, i - 1, (bar) => bar.volume) : 0;
  const launchVolNotClimax = priorMaxVol > 0 && bars[i].volume <= priorMaxVol * 1.2;

  return {
    close: bars[i].close,
    open: bars[i].open,
    ma5,
    ma10,
    ma5Prev,
    dif: cur.dif,
    dea: cur.dea,
    hist: cur.hist,
    histPrev: prev.hist,
    histPrev2: prev2.hist,
    dayPct,
    yangPct,
    threeDayPct,
    pullbackPct,
    aboveMa5: closes[i] > ma5,
    reclaimMa5,
    opensMas,
    strongYang,
    nearLimit,
    macdTurning,
    holdsFloor,
    bottomShrinkVol,
    launchVolNotClimax,
  };
}

export function buyReasons(tech: BuySetupFlags): string[] {
  const rows: string[] = [];
  if (tech.pullbackPct != null && tech.pullbackPct >= 8) rows.push("急跌回撤");
  if (tech.holdsFloor) rows.push("二次探底不破");
  if (tech.bottomShrinkVol) rows.push("底部分量");
  if (tech.macdTurning) rows.push("MACD绿柱翻头");
  if (tech.reclaimMa5) rows.push("收盘站上五日线");
  if (tech.opensMas) rows.push("均线打开");
  if (tech.nearLimit) rows.push("涨停确认");
  else if (tech.strongYang) rows.push("大阳确认");
  if (tech.launchVolNotClimax) rows.push("启动非天量");
  return rows;
}

export function passesBuySetup(tech: BuySetupFlags): boolean {
  return (
    tech.pullbackPct != null &&
    tech.pullbackPct >= 8 &&
    tech.holdsFloor &&
    tech.reclaimMa5 &&
    tech.strongYang &&
    tech.macdTurning &&
    tech.opensMas &&
    tech.bottomShrinkVol
  );
}
