/**
 * 日线顶和底。最近 7 根的最高价、最低价、收盘价放进同一次一元回归，得到一条斜率。
 * 斜率为正是向上，越大涨得越强；斜率为负是向下，越负跌得越强。
 * 再用 7 日 EMA 看短期步伐。不是同花顺的公式。
 *
 * 顶：这 7 天都在 DIF > DEA。斜率仍为正，但比上一天小，收盘 EMA 的抬升也变慢。
 * 底：这 7 天都在 DEA > DIF。斜率仍为负，但比上一天更靠近 0，收盘 EMA 的下跌也变慢。
 * 同一段连续满足时只标第一天。
 */

import type { KBar } from "./types";

const WINDOW = 7;

export type DailyMark = {
  index: number;
  time: string;
  side: "bottom" | "top";
  price: number;
};

type MacdBar = { dif: number; dea: number; hist: number };

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

function macdSeries(closes: number[]): Array<MacdBar | null> {
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
  const out: Array<MacdBar | null> = Array(closes.length).fill(null);
  for (let j = 0; j < difVals.length; j += 1) {
    if (deaVals[j] == null) continue;
    const dif = difVals[j];
    const dea = deaVals[j]!;
    out[map[j]] = { dif, dea, hist: 2 * (dif - dea) };
  }
  return out;
}

/** 最近 7 天的高、低、收盘放在同一条时间轴上，做一次一元回归。 */
export function pooledSlope(bars: KBar[], index: number): number | null {
  if (index < WINDOW - 1) return null;
  let sumY = 0;
  let sumXY = 0;
  for (let step = 0; step < WINDOW; step += 1) {
    const bar = bars[index - (WINDOW - 1) + step];
    for (const value of [bar.high, bar.low, bar.close]) {
      if (!Number.isFinite(value)) return null;
      sumY += value;
      sumXY += step * value;
    }
  }
  const n = WINDOW * 3;
  const sumX = (3 * WINDOW * (WINDOW - 1)) / 2;
  const sumX2 = (3 * WINDOW * (WINDOW - 1) * (2 * WINDOW - 1)) / 6;
  const denom = n * sumX2 - sumX * sumX;
  return (n * sumXY - sumX * sumY) / denom;
}

export function dailyExtremes(bars: KBar[]): DailyMark[] {
  if (bars.length < WINDOW + 2) return [];
  const closes = bars.map((bar) => bar.close);
  const macd = macdSeries(closes);
  const ema = emaSeries(closes, WINDOW);
  const marks: DailyMark[] = [];
  let lastSide: "top" | "bottom" | null = null;
  let lastIndex = -1;

  for (let i = WINDOW + 1; i < bars.length; i += 1) {
    const slope = pooledSlope(bars, i);
    const prevSlope = pooledSlope(bars, i - 1);
    const emaNow = ema[i];
    const emaPrev = ema[i - 1];
    const emaOlder = ema[i - 2];
    if (slope == null || prevSlope == null || emaNow == null || emaPrev == null || emaOlder == null) continue;
    let redZone = true;
    let greenZone = true;
    for (let step = 0; step < WINDOW; step += 1) {
      const bar = macd[i - step];
      if (!bar || !(bar.dif > bar.dea)) redZone = false;
      if (!bar || !(bar.dea > bar.dif)) greenZone = false;
    }
    const pace = emaNow - emaPrev;
    const prevPace = emaPrev - emaOlder;
    let side: "top" | "bottom" | null = null;
    if (redZone && slope > 0 && slope < prevSlope && pace < prevPace) side = "top";
    else if (greenZone && slope < 0 && slope > prevSlope && pace > prevPace) side = "bottom";
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
    marks.push({ index: i, time: bars[i].time, side, price: bars[i].close });
  }
  return marks;
}
