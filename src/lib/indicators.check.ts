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

const hookTightenCloses = [...Array.from({ length: 70 }, (_, i) => 40 - i * 0.28)];
let hookTightenPrice = hookTightenCloses.at(-1)!;
for (let i = 0; i < 8; i += 1) {
  hookTightenPrice += 0.05;
  hookTightenCloses.push(hookTightenPrice);
}
hookTightenPrice -= 0.4;
hookTightenCloses.push(hookTightenPrice);
hookTightenPrice += 0.3;
hookTightenCloses.push(hookTightenPrice);
const hookTighten = buildRedRibbon(hookTightenCloses.map((close, index) => barAt(index, close)));
const hookBuy = hookTighten.signals.at(-1);
const hookBuyAt = hookTighten.points.findIndex((point) => point.time === hookBuy?.time);
const hookSpread = ribbonSpread(hookTighten.points[hookBuyAt].values);
const hookSpreadPrev = ribbonSpread(hookTighten.points[hookBuyAt - 1].values);
const hookSpreadPrev2 = ribbonSpread(hookTighten.points[hookBuyAt - 2].values);
const hookMa = maAt(hookTightenCloses, 5, hookBuyAt);
const hookMaPrev = maAt(hookTightenCloses, 5, hookBuyAt - 1);
const hookMaPrev2 = maAt(hookTightenCloses, 5, hookBuyAt - 2);
assert(
  hookBuy?.side === "buy" &&
    hookBuyAt === hookTighten.points.length - 1 &&
    hookTighten.signals.some((item) => item.side === "sell" && hookTighten.points.findIndex((point) => point.time === item.time) < hookBuyAt) &&
    hookTighten.points[hookBuyAt].direction.every((item) => item === "down") &&
    hookSpread < hookSpreadPrev &&
    !(hookSpreadPrev < hookSpreadPrev2) &&
    hookMa != null &&
    hookMaPrev != null &&
    hookMaPrev2 != null &&
    hookMa > hookMaPrev &&
    hookMaPrev <= hookMaPrev2,
  "a fully cyan ribbon that tightens for one day as MA5 hooks up marks a buy",
);

const rehookCloses = [...Array.from({ length: 70 }, (_, i) => 40 - i * 0.2)];
let rehookPrice = rehookCloses.at(-1)!;
for (let i = 0; i < 7; i += 1) {
  rehookPrice += 0.06;
  rehookCloses.push(rehookPrice);
}
rehookPrice -= 0.25;
rehookCloses.push(rehookPrice);
rehookPrice -= 0.2;
rehookCloses.push(rehookPrice);
const rehook = buildRedRibbon(rehookCloses.map((close, index) => barAt(index, close)));
const rehookSell = rehook.signals.at(-1);
const rehookSellAt = rehook.points.findIndex((point) => point.time === rehookSell?.time);
const rehookPrevAt = rehookSellAt - 1;
const rehookSpread = ribbonSpread(rehook.points[rehookSellAt].values);
const rehookSpreadPrev = ribbonSpread(rehook.points[rehookPrevAt].values);
const rehookSpreadPrev2 = ribbonSpread(rehook.points[rehookSellAt - 2].values);
const rehookMa = maAt(rehookCloses, 5, rehookSellAt);
const rehookMaPrev = maAt(rehookCloses, 5, rehookPrevAt);
const rehookMaPrev2 = maAt(rehookCloses, 5, rehookSellAt - 2);
const rehookHookMa = maAt(rehookCloses, 5, rehookPrevAt);
const rehookHookMaPrev = maAt(rehookCloses, 5, rehookPrevAt - 1);
const rehookHookMaPrev2 = maAt(rehookCloses, 5, rehookPrevAt - 2);
assert(
  rehook.signals.some((item) => item.side === "buy") &&
    rehookSell?.side === "sell" &&
    rehookSellAt === rehook.points.length - 1 &&
    rehook.signals.every((item) => item.time !== rehook.points[rehookPrevAt].time) &&
    rehook.points[rehookSellAt].direction.every((item) => item === "down") &&
    rehookSpread > rehookSpreadPrev &&
    rehookSpread > rehookSpreadPrev2 &&
    Math.min(...rehook.points[rehookSellAt].values) < Math.min(...rehook.points[rehookPrevAt].values) &&
    rehookMa != null &&
    rehookMaPrev != null &&
    rehookMaPrev2 != null &&
    rehookMa < rehookMaPrev &&
    rehookMaPrev < rehookMaPrev2 &&
    rehookHookMa != null &&
    rehookHookMaPrev != null &&
    rehookHookMaPrev2 != null &&
    rehookHookMa < rehookHookMaPrev &&
    rehookHookMaPrev >= rehookHookMaPrev2,
  "a cyan ribbon that fans out after MA5 has already hooked down marks a sell",
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

const turnCloses = [...Array.from({ length: 70 }, (_, i) => 40 - i * 0.25)];
let turnPrice = turnCloses.at(-1)!;
for (let i = 0; i < 3; i += 1) {
  turnPrice += 0.35;
  turnCloses.push(turnPrice);
}
for (let i = 0; i < 20; i += 1) {
  turnPrice += 0.2;
  turnCloses.push(turnPrice);
}
for (let i = 0; i < 3; i += 1) {
  turnPrice -= 0.35;
  turnCloses.push(turnPrice);
}
const turnRibbon = buildRedRibbon(turnCloses.map((close, index) => barAt(index, close)));
const turnBuyAt = turnRibbon.points.findIndex((point) => point.time === turnRibbon.signals[0]?.time);
const turnSell = turnRibbon.signals.find((item) => item.side === "sell");
const turnSellAt = turnRibbon.points.findIndex((point) => point.time === turnSell?.time);
const turnBuyMa = maAt(turnCloses, 5, turnBuyAt);
const turnBuyMaPrev = maAt(turnCloses, 5, turnBuyAt - 1);
const turnBuyMaPrev2 = maAt(turnCloses, 5, turnBuyAt - 2);
const turnSellMa = maAt(turnCloses, 5, turnSellAt);
const turnSellMaPrev = maAt(turnCloses, 5, turnSellAt - 1);
const turnSellMaPrev2 = maAt(turnCloses, 5, turnSellAt - 2);
const cameFromDown = turnRibbon.points.slice(Math.max(1, turnBuyAt - 8), turnBuyAt).some((point) => point.direction.every((item) => item === "down"));
assert(
  turnRibbon.signals[0]?.side === "buy" &&
    turnRibbon.points[turnBuyAt].direction.some((item) => item === "up") &&
    !turnRibbon.points[turnBuyAt].direction.every((item) => item === "down") &&
    cameFromDown &&
    turnBuyMa != null &&
    turnBuyMaPrev != null &&
    turnBuyMaPrev2 != null &&
    turnBuyMa > turnBuyMaPrev &&
    turnBuyMaPrev <= turnBuyMaPrev2,
  "a cyan ribbon turning red as MA5 hooks up marks a buy",
);
assert(
  turnSellAt > turnBuyAt &&
    turnRibbon.points[turnSellAt - 1].direction.every((item) => item === "up") &&
    turnRibbon.points[turnSellAt].direction.some((item) => item === "down") &&
    turnSellMa != null &&
    turnSellMaPrev != null &&
    turnSellMaPrev2 != null &&
    turnSellMa < turnSellMaPrev &&
    turnSellMaPrev >= turnSellMaPrev2,
  "a red ribbon turning cyan as MA5 hooks down marks a sell",
);

const reboundCloses = [...Array.from({ length: 50 }, (_, i) => 30 - i * 0.2)];
let reboundPrice = reboundCloses.at(-1)!;
for (let i = 0; i < 6; i += 1) {
  reboundPrice += 0.08;
  reboundCloses.push(reboundPrice);
}
for (let i = 0; i < 28; i += 1) {
  reboundPrice += 0.18;
  reboundCloses.push(reboundPrice);
}
for (let i = 0; i < 8; i += 1) {
  reboundPrice -= 0.04;
  reboundCloses.push(reboundPrice);
}
for (let i = 0; i < 6; i += 1) {
  reboundPrice += 0.35;
  reboundCloses.push(reboundPrice);
}
const rebound = buildRedRibbon(reboundCloses.map((close, index) => barAt(index, close)));
const reboundSellAt = rebound.points.findIndex((point) => point.time === rebound.signals.find((item) => item.side === "sell")?.time);
const reboundBuy = rebound.signals.filter((item) => item.side === "buy").at(-1);
const reboundBuyAt = rebound.points.findIndex((point) => point.time === reboundBuy?.time);
const reboundSpread = ribbonSpread(rebound.points[reboundBuyAt].values);
const reboundSpreadPrev = ribbonSpread(rebound.points[reboundBuyAt - 1].values);
const reboundMa = maAt(reboundCloses, 5, reboundBuyAt);
const reboundMaPrev = maAt(reboundCloses, 5, reboundBuyAt - 1);
const reboundMaPrev2 = maAt(reboundCloses, 5, reboundBuyAt - 2);
assert(
  reboundSellAt < reboundBuyAt &&
    rebound.points[reboundSellAt].direction.every((item) => item === "up") &&
    rebound.points[reboundBuyAt].direction.every((item) => item === "up") &&
    reboundSpread > reboundSpreadPrev &&
    reboundMa != null &&
    reboundMaPrev != null &&
    reboundMaPrev2 != null &&
    reboundMa > reboundMaPrev &&
    reboundMaPrev <= reboundMaPrev2,
  "after a red-ribbon sell, a fresh MA5 hook and an upward fan marks another buy",
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
