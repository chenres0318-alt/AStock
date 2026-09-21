import { analyzeCloses, maAt, macdSeries, passesBoardTech, passesStockTech } from "./indicators.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function almost(a: number, b: number, eps = 1e-6) {
  assert(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
}

const sma10 = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29];
almost(maAt(sma10, 10, 9)!, sma10.reduce((sum, value) => sum + value, 0) / 10);

assert(analyzeCloses(Array.from({ length: 20 }, (_, i) => 10 + i)) == null, "short series should be rejected");

const rising = Array.from({ length: 60 }, (_, i) => 10 + i * 0.2);
const up = analyzeCloses(rising)!;
assert(up.aboveMa5, "rising close should sit above MA5");
assert(up.threeDayPct != null && up.threeDayPct > 0, "rising 3-day gain should be positive");
assert(!passesBoardTech(up), "steady uptrend should not pass the death-cross board filter");

const falling = Array.from({ length: 80 }, (_, i) => 50 * Math.pow(0.99, i));
const down = analyzeCloses(falling)!;
const macd = macdSeries(falling).at(-1)!;
almost(macd.hist, 2 * (macd.dif - macd.dea));
assert(down.aboveMa5 === false, "persistent decline should sit below MA5");
assert(!passesBoardTech(down), "pure downtrend should not pass board filter");

// Frozen 东方财富 daily closes that currently satisfy the board pattern.
const eastMoney = [
  19.77, 19.9, 19.67, 19.98, 19.5, 19.87, 20.05, 19.61, 19.19, 19.16, 18.97, 18.91, 18.91, 18.74, 18.52, 17.72, 17.88,
  17.78, 17.36, 18.0, 18.89, 19.12, 19.04, 18.6, 20.97, 20.9, 20.18, 21.11, 20.07, 20.1, 20.38, 21.45, 20.73, 21.06,
  21.18, 20.29, 20.13, 20.59, 20.19, 19.84, 19.6, 20.14, 19.82, 19.7, 20.18, 20.29, 20.08, 20.28, 19.4, 19.65, 19.42,
  19.9, 19.99, 20.17, 20.01, 20.05, 20.36, 20.01, 19.98, 20.03, 19.84, 19.83, 19.78, 19.47, 19.58, 19.23, 18.73, 18.8,
  18.91, 18.92, 18.93, 19.36, 19.62, 19.42, 19.39, 19.4, 18.91, 19.01, 19.15, 18.99, 18.84, 18.91, 18.97, 18.31, 18.22,
  18.17, 18.39, 18.09, 18.37, 18.69,
];
const bounce = analyzeCloses(eastMoney)!;
assert(bounce.aboveMa5, "fixture should stand above MA5");
assert(bounce.ma5TurnUp, "fixture MA5 should turn up");
assert(bounce.deathCross, "fixture should be in death-cross");
assert(bounce.greenShrinking, "fixture green bars should shrink");
assert(bounce.nearZeroAxis, "fixture histogram should be near zero");
assert(passesBoardTech(bounce), "fixture should pass board rules");
assert(bounce.threeDayPct != null && bounce.threeDayPct <= 4, "fixture 3-day gain should stay modest");
assert(passesStockTech(bounce, 2.5), "fixture should pass stock rules with 2.5% turnover");
assert(!passesStockTech(bounce, 1.2), "stock rules should reject low turnover");
assert(!passesStockTech(bounce, null), "stock rules should reject missing turnover");

console.log("indicators.check ok", {
  hist: bounce.hist.toFixed(4),
  threeDayPct: bounce.threeDayPct?.toFixed(2),
});
