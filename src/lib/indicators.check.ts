import { adxSeries, analyzeBars, buildRedRibbon, findBuyPoints, findTrendSwingBuys, klineRangeChange, maAt, macdSeries, passesScreen, screenReasons, tdSequential } from "./indicators.ts";
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

const risingTd = tdSequential(risingCloses(20, 10, 1).map((close, i) => ({ time: `u${i}`, close })));
assert(risingTd[0]?.side === "up" && risingTd[0].count === 1, "first bar above close[i-4] starts up count at 1");
assert(risingTd[8]?.count === 9 && risingTd[8].side === "up", "ninth consecutive higher close is up 9");
assert(risingTd.length === 9, "a steady rise keeps one finished 9 and does not start another");

const fallingTd = tdSequential(fallingCloses(14, 40, 1).map((close, i) => ({ time: `d${i}`, close })));
assert(fallingTd.length === 9 && fallingTd[8]?.count === 9 && fallingTd[8].side === "down", "ninth consecutive lower close is down 9");

const aborted = tdSequential([5, 5, 5, 5, 5, 8, 9, 10, 4].map((close, i) => ({ time: `a${i}`, close })));
assert(aborted.length === 1 && aborted[0].side === "down" && aborted[0].count === 1, "a broken rise is dropped, and the new live flip shows 1");

const flatThenUp = tdSequential([
  { time: "a", close: 5 },
  { time: "b", close: 1 },
  { time: "c", close: 1 },
  { time: "d", close: 1 },
  { time: "e", close: 5 },
  { time: "f", close: 8 },
]);
assert(flatThenUp.length === 1 && flatThenUp[0].time === "f" && flatThenUp[0].count === 1, "the latest one-bar flip is visible the same day");

const forming = tdSequential(risingCloses(8, 10, 1).map((close, i) => ({ time: `f${i}`, close })));
assert(forming.length === 4 && forming[0]?.count === 1 && forming[3]?.count === 4, "an open setup shows from 1, not only after 6");

const broken = tdSequential([1, 2, 3, 4, 5, 6, 7, 8, 9, 5].map((close, i) => ({ time: `m${i}`, close })));
assert(broken.length === 1 && broken[0].side === "down" && broken[0].count === 1, "an interrupted rise is dropped, and the new flip shows 1");

function swingBars() {
  const bars = Array.from({ length: 80 }, (_, i) => {
    const close = 20 + i * 0.05;
    return {
      time: `2024-04-${String((i % 28) + 1).padStart(2, "0")}-${i}`,
      open: Number((close * 0.997).toFixed(4)),
      high: Number((close * 1.015).toFixed(4)),
      low: Number((close * 0.985).toFixed(4)),
      close,
      volume: 1000,
      mainNet: 100,
    };
  });
  const i = bars.length - 1;
  const closes = bars.map((bar) => bar.close);
  const ma30 = maAt(closes, 30, i)!;
  const ma30Prev = maAt(closes, 30, i - 1)!;
  const prevClose = bars[i - 1].close;
  const close = Math.max(ma30 + 0.05, prevClose * 1.03);
  bars[i].open = ma30Prev;
  bars[i].close = close;
  bars[i].high = Math.max(bars[i].open, close) * 1.01;
  bars[i].low = Math.min(bars[i].open, close) * 0.99;
  bars[i].volume = 2000;
  return bars;
}

const swing = swingBars();
const swingHits = findTrendSwingBuys(swing);
assert(swingHits.length === 1 && swingHits[0].time === swing.at(-1)?.time, "a qualified trend swing day is a buy");
const outflow = swing.map((bar, index) => (index === swing.length - 1 ? { ...bar, mainNet: -1 } : bar));
assert(!findTrendSwingBuys(outflow).some((point) => point.time === swing.at(-1)?.time), "main-force outflow is not a buy");
const chase = swing.map((bar, index) =>
  index === swing.length - 1 ? { ...bar, close: swing[index - 1].close * 1.09, high: swing[index - 1].close * 1.1 } : bar,
);
assert(!findTrendSwingBuys(chase).some((point) => point.time === swing.at(-1)?.time), "an 8%+ day is not chased");
const gapped = swing.map((bar, index) => (index === swing.length - 1 ? { ...bar, open: bar.open + 2 } : bar));
assert(!findTrendSwingBuys(gapped).some((point) => point.time === swing.at(-1)?.time), "opening through MA30 resistance is not a buy");

function barAt(index: number, close: number, volume = 1000): KBar {
  const open = close * 0.998;
  return {
    time: `2024-01-${String((index % 28) + 1).padStart(2, "0")}-${index}`,
    open,
    high: Math.max(open, close) * 1.004,
    low: Math.min(open, close) * 0.996,
    close,
    volume,
  };
}

const flat = Array.from({ length: 80 }, (_, i) => barAt(i, 20));
const flatRibbon = buildRedRibbon(flat);
assert(flatRibbon.signals.length === 0, "a flat tape has no ribbon trade");
assert(flatRibbon.points.at(-1)?.direction.every((item) => item == null), "a flat ribbon does not paint up or down");

const climb = Array.from({ length: 90 }, (_, i) => barAt(i, 10 + i * 0.2));
const climbRibbon = buildRedRibbon(climb);
assert(climbRibbon.points.at(-1)?.direction.every((item) => item === "up"), "a steady climb turns every ribbon layer up");

const drop = Array.from({ length: 90 }, (_, i) => barAt(i, 40 - i * 0.2));
assert(buildRedRibbon(drop).points.at(-1)?.direction.every((item) => item === "down"), "a steady drop turns every ribbon layer down");

assert(buildRedRibbon(drop).signals.length === 0, "a steady cyan decline does not buy while MA5 is still falling");
assert(climbRibbon.signals.length === 0, "a red climb does not sell before a buy");

function ribbonSpread(values: number[]) {
  return Math.max(...values) - Math.min(...values);
}

const convergeCloses = [...Array.from({ length: 70 }, (_, i) => 40 - i * 0.28)];
let convergePrice = convergeCloses.at(-1)!;
for (let i = 0; i < 8; i += 1) {
  convergePrice += 0.05;
  convergeCloses.push(convergePrice);
}
const converge = buildRedRibbon(convergeCloses.map((close, index) => barAt(index, close)));
const convergeBuy = converge.signals[0];
const convergeBuyAt = converge.points.findIndex((point) => point.time === convergeBuy?.time);
const convergeSpread = ribbonSpread(converge.points[convergeBuyAt].values);
const convergeSpreadPrev = ribbonSpread(converge.points[convergeBuyAt - 1].values);
const convergeSpreadPrev2 = ribbonSpread(converge.points[convergeBuyAt - 2].values);
const convergeMa = maAt(convergeCloses, 5, convergeBuyAt);
const convergeMaPrev = maAt(convergeCloses, 5, convergeBuyAt - 1);
assert(
  converge.signals.length === 1 &&
    convergeBuy?.side === "buy" &&
    converge.points[convergeBuyAt].direction.every((item) => item === "down") &&
    convergeSpread < convergeSpreadPrev &&
    convergeSpreadPrev < convergeSpreadPrev2 &&
    convergeMa != null &&
    convergeMaPrev != null &&
    convergeMa > convergeMaPrev,
  "a cyan ribbon that keeps narrowing while MA5 turns up marks one buy",
);

const divergeCloses = convergeCloses.slice();
let divergePrice = divergeCloses.at(-1)!;
for (let i = 0; i < 12; i += 1) {
  divergePrice -= 0.18;
  divergeCloses.push(divergePrice);
}
const diverge = buildRedRibbon(divergeCloses.map((close, index) => barAt(index, close)));
const divergeSell = diverge.signals.find((item) => item.side === "sell");
const divergeSellAt = diverge.points.findIndex((point) => point.time === divergeSell?.time);
const divergeSpread = ribbonSpread(diverge.points[divergeSellAt].values);
const divergeSpreadPrev = ribbonSpread(diverge.points[divergeSellAt - 1].values);
const divergeSpreadPrev2 = ribbonSpread(diverge.points[divergeSellAt - 2].values);
const divergeMa = maAt(divergeCloses, 5, divergeSellAt);
const divergeMaPrev = maAt(divergeCloses, 5, divergeSellAt - 1);
const divergeMaPrev2 = maAt(divergeCloses, 5, divergeSellAt - 2);
assert(
  diverge.signals[0]?.side === "buy" &&
    divergeSellAt > convergeBuyAt &&
    diverge.points[divergeSellAt].direction.every((item) => item === "down") &&
    divergeSpread > divergeSpreadPrev &&
    divergeSpread > divergeSpreadPrev2 &&
    Math.min(...diverge.points[divergeSellAt].values) < Math.min(...diverge.points[divergeSellAt - 1].values) &&
    divergeMa != null &&
    divergeMaPrev != null &&
    divergeMaPrev2 != null &&
    divergeMa < divergeMaPrev &&
    divergeMaPrev >= divergeMaPrev2,
  "a cyan ribbon fanning downward again as MA5 turns down marks a sell",
);

const redCloses = [...Array.from({ length: 50 }, (_, i) => 30 - i * 0.2)];
let redPrice = redCloses.at(-1)!;
for (let i = 0; i < 6; i += 1) {
  redPrice += 0.08;
  redCloses.push(redPrice);
}
for (let i = 0; i < 28; i += 1) {
  redPrice += 0.18;
  redCloses.push(redPrice);
}
for (let i = 0; i < 8; i += 1) {
  redPrice -= 0.04;
  redCloses.push(redPrice);
}
const redContract = buildRedRibbon(redCloses.map((close, index) => barAt(index, close)));
const redSell = redContract.signals.find((item) => item.side === "sell");
const redSellAt = redContract.points.findIndex((point) => point.time === redSell?.time);
const redBuyAt = redContract.points.findIndex((point) => point.time === redContract.signals[0]?.time);
const redSpread = ribbonSpread(redContract.points[redSellAt].values);
const redSpreadPrev = ribbonSpread(redContract.points[redSellAt - 1].values);
const redMa = maAt(redCloses, 5, redSellAt);
const redMaPrev = maAt(redCloses, 5, redSellAt - 1);
const redMaPrev2 = maAt(redCloses, 5, redSellAt - 2);
assert(
  redContract.signals[0]?.side === "buy" &&
    redSellAt > redBuyAt &&
    redContract.points[redSellAt].direction.every((item) => item === "up") &&
    redSpread < redSpreadPrev &&
    redMa != null &&
    redMaPrev != null &&
    redMaPrev2 != null &&
    redMa < redMaPrev &&
    redMaPrev >= redMaPrev2,
  "a red ribbon that starts narrowing as MA5 turns down marks a sell",
);

const laggedCloses: number[] = [];
let lagged = 30;
for (let i = 0; i < 50; i += 1) {
  lagged *= 0.985;
  laggedCloses.push(lagged);
}
for (let i = 0; i < 12; i += 1) {
  lagged *= 1.02;
  laggedCloses.push(lagged);
}
const laggedRibbon = buildRedRibbon(laggedCloses.map((close, i) => barAt(i, close)));
assert(laggedRibbon.points[51].direction.some((item) => item !== "up"), "the first MA5 stand can arrive before every layer is red");

const chop = Array.from({ length: 160 }, (_, i) => barAt(i, 20 + Math.sin(i / 2) * 0.08));
assert(adxSeries(chop).every((value) => value == null || value <= 22), "a tight box stays at or below the ADX gate");

const rangeBars = [10, 11, 12].map((close, index) => barAt(index, close));
const forward = klineRangeChange(rangeBars, rangeBars[0].time, rangeBars[2].time);
assert(forward?.count === 3 && forward.from === rangeBars[0].time && forward.to === rangeBars[2].time, "range change uses close to close");
almost(forward?.pct ?? NaN, 0.2);
const reversed = klineRangeChange(rangeBars, rangeBars[2].time, rangeBars[0].time);
assert(reversed?.from === forward?.from && reversed?.to === forward?.to && reversed?.count === 3, "a right-to-left drag uses the same interval");
assert(klineRangeChange([], "a", "b") === null, "an empty range has no change");

console.log("indicators.check ok", {
  bull: { firstStandMa5: bull.firstStandMa5, macdBull: bull.macdBull, macdBearWeak: bull.macdBearWeak, dea: bull.dea.toFixed(3) },
  bounce: {
    firstStandMa5: bounce.firstStandMa5,
    macdBull: bounce.macdBull,
    macdBearWeak: bounce.macdBearWeak,
    hist: bounce.hist.toFixed(4),
  },
});
