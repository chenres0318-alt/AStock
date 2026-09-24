import type { KBar } from "./types";

export const MAX_HOLD_BARS = 30;

function ma5At(closes: number[], index: number): number | null {
  if (index < 4 || index >= closes.length) return null;
  return (closes[index - 4] + closes[index - 3] + closes[index - 2] + closes[index - 1] + closes[index]) / 5;
}

function meanVolume(bars: KBar[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let j = from; j < to; j += 1) {
    if (j < 0) continue;
    sum += bars[j].volume;
    n += 1;
  }
  return n ? sum / n : 0;
}

function maxVolume(bars: KBar[], from: number, to: number): number {
  let peak = 0;
  for (let j = from; j < to; j += 1) {
    if (j < 0) continue;
    peak = Math.max(peak, bars[j].volume);
  }
  return peak;
}

/** 放量长上影、冲高回落：涨停后的卖点形态，不是涨停本身。 */
export function isExhaustionBar(bars: KBar[], i: number, limitPct = 10): boolean {
  if (i < 1) return false;
  const bar = bars[i];
  const prev = bars[i - 1];
  const range = bar.high - bar.low;
  if (range <= 0 || prev.close <= 0) return false;
  const dayPct = (bar.close / prev.close - 1) * 100;
  if (dayPct >= limitPct - 0.6) return false;
  const upper = bar.high - Math.max(bar.open, bar.close);
  const longShadow = upper / range >= 0.35 && bar.close <= bar.low + range * 0.55;
  const avg = meanVolume(bars, i - 10, i);
  const peak = maxVolume(bars, i - 10, i);
  const climax = (avg > 0 && bar.volume >= avg * 1.3) || (peak > 0 && bar.volume >= peak * 0.9);
  const failHold = bar.close < bar.high * 0.97;
  return longShadow && climax && failHold;
}

export function shouldExitBuy(
  bars: KBar[],
  i: number,
  entryIdx: number,
  limitPct = 10,
): { exit: boolean; reason: string } {
  if (i <= entryIdx) return { exit: false, reason: "" };
  const closes = bars.map((bar) => bar.close);
  const ma5 = ma5At(closes, i);
  let exhaustSeen = false;
  for (let j = entryIdx + 1; j <= i; j += 1) {
    if (isExhaustionBar(bars, j, limitPct)) exhaustSeen = true;
  }
  if (exhaustSeen && ma5 != null && bars[i].close < ma5) {
    return { exit: true, reason: "涨停后放量长上影且跌破五日线" };
  }
  if (i - entryIdx >= MAX_HOLD_BARS) {
    return { exit: true, reason: "持仓满30个交易日" };
  }
  return { exit: false, reason: "" };
}
