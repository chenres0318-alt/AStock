import { dailyExtremes, pooledSlope } from "./dailyExtreme.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function session(parts: Array<{ n: number; step: number }>, origin: number): KBar[] {
  const bars: KBar[] = [];
  let price = origin;
  for (const part of parts) {
    for (let i = 0; i < part.n; i += 1) {
      price = Math.round((price + part.step) * 100) / 100;
      const time = `2026-01-${String(bars.length + 1).padStart(3, "0")}`;
      bars.push({ time, open: price, high: price + 0.1, low: price - 0.1, close: price, volume: 1000 });
    }
  }
  return bars;
}

assert(dailyExtremes(session([{ n: 80, step: 0 }], 20)).length === 0, "a flat daily tape has no top or bottom");
assert(
  dailyExtremes(session([{ n: 40, step: 0 }, { n: 30, step: 0.2 }], 20)).length === 0,
  "a steady rise whose slope is not shrinking has no top",
);

const easingRise = session(
  [
    { n: 45, step: 0 },
    { n: 8, step: 0.8 },
    { n: 12, step: 0.15 },
  ],
  20,
);
const tops = dailyExtremes(easingRise);
assert(tops[0]?.side === "top" && tops[0].price === 27.3, "a rise that is still up but slowing is a top");
const topSlope = pooledSlope(easingRise, tops[0].index);
const prevTopSlope = pooledSlope(easingRise, tops[0].index - 1);
assert(
  topSlope != null && prevTopSlope != null && topSlope > 0 && topSlope < prevTopSlope,
  "the top keeps a positive slope of high, low, and close, smaller than the previous day",
);

const crash = session(
  [
    { n: 45, step: 0 },
    { n: 8, step: -0.7 },
    { n: 20, step: -0.1 },
  ],
  20,
);
assert(
  dailyExtremes(crash).every((mark) => mark.side !== "bottom"),
  "a crash still more than 8% under a falling 20-day average is not a bottom",
);

const easingDrop = session(
  [
    { n: 40, step: 0 },
    { n: 30, step: -0.05 },
    { n: 12, step: -0.01 },
  ],
  30,
);
const bottoms = dailyExtremes(easingDrop).filter((mark) => mark.side === "bottom");
assert(bottoms[0]?.price === 28.49, "a milder drop that slows while still near the 20-day average is a bottom");
const bottomSlope = pooledSlope(easingDrop, bottoms[0].index);
const prevBottomSlope = pooledSlope(easingDrop, bottoms[0].index - 1);
assert(
  bottomSlope != null && prevBottomSlope != null && bottomSlope < 0 && bottomSlope > prevBottomSlope,
  "the bottom keeps a negative slope, closer to zero than the previous day",
);

console.log("dailyExtreme.check ok", tops[0].price, bottoms[0].price);
