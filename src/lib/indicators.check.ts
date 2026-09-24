import { analyzeBars, findBuyPoints, maAt, macdSeries, passesScreen, screenReasons } from "./indicators.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function almost(a: number, b: number, eps = 1e-6) {
  assert(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
}

function barsFromCloses(closes: number[]): KBar[] {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1];
    const open = Number(((prev * 0.4 + close * 0.6)).toFixed(4));
    return {
      time: new Date(Date.UTC(2024, 0, 2 + i)).toISOString().slice(0, 10),
      open,
      high: Number((Math.max(open, close) * 1.012).toFixed(4)),
      low: Number((Math.min(open, close) * 0.988).toFixed(4)),
      close,
      volume: 1000 + (i % 7) * 40,
    };
  });
}

function risingCloses(days = 50, start = 10, step = 0.2): number[] {
  return Array.from({ length: days }, (_, i) => Number((start + i * step).toFixed(4)));
}

function fallingCloses(days = 50, start = 20, step = 0.15): number[] {
  return Array.from({ length: days }, (_, i) => Number((start - i * step).toFixed(4)));
}

/** Long uptrend, 4 days below MA5, then reclaim. */
function bullFirstStand(): number[] {
  const closes = risingCloses(80, 10, 0.18);
  let p = closes[closes.length - 1];
  for (let i = 0; i < 4; i += 1) {
    p = Number((p * 0.985).toFixed(4));
    closes.push(p);
  }
  closes.push(Number((p * 1.045).toFixed(4)));
  return closes;
}

/** Long decline, then a bounce that can reclaim MA5. */
function bearBounceStand(): number[] {
  const closes = fallingCloses(50, 22, 0.16);
  const last = closes[closes.length - 1];
  closes.push(Number((last * 1.08).toFixed(4)));
  return closes;
}

/** Decline then a tiny poke above MA5 — the 中国平安-style false buy. */
function weakWeaveStand(): number[] {
  const closes = fallingCloses(50, 22, 0.16);
  const last = closes[closes.length - 1];
  closes.push(Number((last * 1.018).toFixed(4)));
  return closes;
}

const sma10 = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29];
almost(maAt(sma10, 10, 9)!, sma10.reduce((sum, value) => sum + value, 0) / 10);

assert(analyzeBars(barsFromCloses(risingCloses(20))) == null, "short series should be rejected");

const falling = barsFromCloses(fallingCloses(60));
const macd = macdSeries(falling.map((bar) => bar.close)).at(-1)!;
almost(macd.hist, 2 * (macd.dif - macd.dea));

const rising = analyzeBars(barsFromCloses(risingCloses(80)))!;
assert(rising.aboveMa5, "steady uptrend close should sit above MA5");
assert(rising.firstStandMa5 === false, "already-above MA5 is not a first stand in 5 days");
assert(rising.macdBull, "steady uptrend should have bullish MACD stack");
assert(!passesScreen(rising), "trend already on MA5 should not pass");

const down = analyzeBars(falling)!;
assert(down.aboveMa5 === false, "persistent decline should sit below MA5");
assert(down.firstStandMa5 === false, "close below MA5 is not a stand");
assert(!passesScreen(down), "pure downtrend should not pass");

const bullBars = barsFromCloses(bullFirstStand());
const bull = analyzeBars(bullBars)!;
assert(bull.firstStandMa5, "pullback then reclaim should be first MA5 stand in 5 days");
assert(bull.macdBull || bull.macdBearWeak, "reclaim after uptrend should keep MACD usable");
assert(passesScreen(bull), "first stand with MACD bull or weakening bear should pass");
assert(screenReasons(bull).includes("近5日首次站上五日线"), "reasons should mention first MA5 stand");
assert(
  screenReasons(bull).includes("MACD多头排列") || screenReasons(bull).includes("MACD空头减弱"),
  "reasons should mention MACD state",
);

const bullHits = findBuyPoints(bullBars);
assert(bullHits.length >= 1, "historical scan should mark the first-stand bar");
assert(bullHits.at(-1)?.time === bullBars[bullBars.length - 1].time, "latest marker should be the reclaim bar");

const follow = barsFromCloses([...bullFirstStand(), Number((bull.close * 1.02).toFixed(4))]);
const late = analyzeBars(follow)!;
assert(late.aboveMa5, "next day can stay above MA5");
assert(late.firstStandMa5 === false, "second day above MA5 is not first stand in 5 days");
assert(!passesScreen(late), "follow-through above MA5 should fail");

const bounceBars = barsFromCloses(bearBounceStand());
const bounce = analyzeBars(bounceBars)!;
assert(bounce.firstStandMa5, "bounce from a decline should first stand on MA5");
assert(bounce.macdBearWeak || bounce.macdBull, "decline bounce should show weakening bear or flipped MACD");
assert(bounce.strongReclaim, "8% bounce should count as a strong reclaim");
assert(passesScreen(bounce), "first stand plus strong MACD reclaim should pass");
assert(findBuyPoints(bounceBars).some((point) => point.time === bounceBars[bounceBars.length - 1].time));
assert(screenReasons(bounce).includes("大阳反包") || !bounce.belowMa20, "below-MA20 bounce should be labeled 大阳反包");

const weaveBars = barsFromCloses(weakWeaveStand());
const weave = analyzeBars(weaveBars)!;
assert(weave.firstStandMa5, "tiny poke can still first-stand MA5");
assert(weave.belowMa20, "slow decline weave should remain below MA20");
assert(weave.strongReclaim === false, "1.8% poke is not a strong reclaim");
assert(!passesScreen(weave), "downtrend weave below MA20 should not be a buy");
assert(!findBuyPoints(weaveBars).some((point) => point.time === weaveBars[weaveBars.length - 1].time));

console.log("indicators.check ok", {
  bull: { firstStandMa5: bull.firstStandMa5, macdBull: bull.macdBull, macdBearWeak: bull.macdBearWeak, dea: bull.dea.toFixed(3) },
  bounce: {
    firstStandMa5: bounce.firstStandMa5,
    macdBull: bounce.macdBull,
    macdBearWeak: bounce.macdBearWeak,
    hist: bounce.hist.toFixed(4),
  },
});
