import { adxSeries, analyzeBars, buildMaLines, findBuyPoints, findTrendSwingBuys, klineRangeChange, maAt, macdSeries, passesScreen, screenReasons, tdSequential } from "./indicators.ts";
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
assert(rising.aboveMa4 && rising.aboveMa7, "steady uptrend close should sit above MA4 and MA7");
assert(rising.ma4TurnUp && rising.ma7TurnUp, "steady uptrend averages should be turning up");
assert(rising.standDays > 2, "a long uptrend has already stood for more than two days");
assert(rising.firstStandMa5 === false, "already-above MA5 is not a first stand in 5 days");
assert(rising.macdBull, "steady uptrend should have bullish MACD stack");
assert(!passesScreen(rising), "a setup that has held more than two days should not pass");
assert(screenReasons(rising).includes("收盘站上4日、7日均线"), "reasons should name standing above both averages");
assert(screenReasons(rising).includes("4日均线拐头向上"), "reasons should name MA4 turning up");
assert(screenReasons(rising).includes("7日均线拐头向上"), "reasons should name MA7 turning up");
assert(!screenReasons(rising).some((row) => row.startsWith("条件成立第")), "a stale streak should not claim freshness");
assert(!passesScreen({ ...rising, aboveMa4: false, standDays: 1 }), "close still under MA4 should not pass");
assert(!passesScreen({ ...rising, aboveMa7: false, standDays: 1 }), "close still under MA7 should not pass");
assert(!passesScreen({ ...rising, ma4TurnUp: false, standDays: 1 }), "MA4 still turning down should not pass");
assert(!passesScreen({ ...rising, ma7TurnUp: false, standDays: 1 }), "MA7 still turning down should not pass");

const down = analyzeBars(falling)!;
assert(down.aboveMa5 === false, "persistent decline should sit below MA5");
assert(down.aboveMa4 === false && down.aboveMa7 === false, "persistent decline should sit below MA4 and MA7");
assert(down.firstStandMa5 === false, "close below MA5 is not a stand");
assert(!passesScreen(down), "pure downtrend should not pass");

const bullBars = barsFromCloses(bullFirstStand());
const bull = analyzeBars(bullBars)!;
assert(bull.firstStandMa5, "pullback then reclaim should be first MA5 stand in 5 days");
assert(bull.aboveMa4 && bull.aboveMa7, "the reclaim close can sit above MA4 and MA7");
assert(bull.ma4TurnUp === false && bull.ma7TurnUp === false, "one reclaim day is not enough to turn both averages up");
assert(bull.macdBull || bull.macdBearWeak, "reclaim after uptrend should keep MACD usable");
assert(!passesScreen(bull), "standing above without turning averages should not pass");

const follow = barsFromCloses([...bullFirstStand(), Number((bull.close * 1.02).toFixed(4))]);
const late = analyzeBars(follow)!;
assert(late.aboveMa5, "next day can stay above MA5");
assert(late.firstStandMa5 === false, "second day above MA5 is not first stand in 5 days");
assert(late.aboveMa4 && late.aboveMa7 && late.ma4TurnUp && late.ma7TurnUp, "follow-through should stand above turning averages");
assert(late.standDays === 1, "the first fully-qualified day is day 1 of the setup");
assert(passesScreen(late), "a first day that stands above turning MA4/MA7 should pass");
assert(screenReasons(late).includes("条件成立第1日"), "reasons should name the first qualified day");

const late2Bars = barsFromCloses([...follow.map((bar) => bar.close), Number((late.close * 1.02).toFixed(4))]);
const late2 = analyzeBars(late2Bars)!;
assert(late2.standDays === 2, "one more up day is still within two days");
assert(passesScreen(late2), "the second consecutive qualified day should still pass");
assert(screenReasons(late2).includes("条件成立第2日"), "reasons should name the second qualified day");

const late3 = analyzeBars(barsFromCloses([...late2Bars.map((bar) => bar.close), Number((late2.close * 1.02).toFixed(4))]))!;
assert(late3.standDays === 3, "the third consecutive day is past the freshness window");
assert(!passesScreen(late3), "a setup that has held three days should not pass");
assert(!passesScreen({ ...late, standDays: 3 }), "mutating standDays past two should fail even if the other flags stay on");

const bounceBars = barsFromCloses(bearBounceStand());
const bounce = analyzeBars(bounceBars)!;
assert(bounce.firstStandMa5, "bounce from a decline should first stand on MA5");
assert(bounce.strongReclaim, "8% bounce should count as a strong reclaim");
assert(bounce.aboveMa4 && bounce.aboveMa7 && bounce.ma4TurnUp && bounce.ma7TurnUp, "an 8% bounce can stand above turning MA4/MA7");
assert(bounce.standDays === 1, "an 8% bounce that first qualifies is day 1");
assert(passesScreen(bounce), "an 8% bounce that stands above turning averages should pass");

const weaveBars = barsFromCloses(weakWeaveStand());
const weave = analyzeBars(weaveBars)!;
assert(weave.firstStandMa5, "tiny poke can still first-stand MA5");
assert(weave.belowMa20, "slow decline weave should remain below MA20");
assert(weave.strongReclaim === false, "1.8% poke is not a strong reclaim");
assert(weave.aboveMa4 && weave.aboveMa7 === false, "a tiny poke may clear MA4 but not MA7");
assert(!passesScreen(weave), "a poke that is not above MA7 should not pass");
assert(!findBuyPoints(weaveBars).some((point) => point.time === weaveBars[weaveBars.length - 1].time));

/** Drift, then a decline, then two modest up days: MA4 crosses above MA7 while the MACD bar is still negative but shorter. */
function ma4CrossWhileBearWeakens(): number[] {
  const closes: number[] = [];
  let price = 20;
  for (let i = 0; i < 30; i += 1) {
    closes.push(Number(price.toFixed(4)));
    price *= 1.0005;
  }
  for (let i = 0; i < 20; i += 1) {
    price *= 0.996;
    closes.push(Number(price.toFixed(4)));
  }
  for (let i = 0; i < 2; i += 1) {
    price *= 1.015;
    closes.push(Number(price.toFixed(4)));
  }
  return closes;
}

const crossCloses = ma4CrossWhileBearWeakens();
const crossBars = barsFromCloses(crossCloses);
const cross = analyzeBars(crossBars)!;
assert(cross.ma4CrossUpMa7, "last bar should cross MA4 up through MA7");
assert(cross.ma4 > cross.ma7, "MA4 should finish above MA7");
assert(cross.aboveMa4 && cross.aboveMa7, "the cross-day close should sit above both averages");
assert(cross.ma4TurnUp && cross.ma7TurnUp, "both averages should be turning up on the cross day");
assert(cross.standDays === 1, "the cross day is the first qualified day");
assert(passesScreen(cross), "close above turning MA4/MA7 should pass even on a golden-cross day");
assert(screenReasons(cross).includes("收盘站上4日、7日均线"), "reasons should name standing above both averages");
assert(screenReasons(cross).includes("4日均线拐头向上"), "reasons should name MA4 turning up");
assert(screenReasons(cross).includes("7日均线拐头向上"), "reasons should name MA7 turning up");
assert(screenReasons(cross).includes("条件成立第1日"), "reasons should name the first qualified day");
assert(!passesScreen({ ...cross, ma7TurnUp: false }), "standing above with MA7 still down should not pass");
assert(!passesScreen({ ...cross, ma4TurnUp: false }), "standing above with MA4 still down should not pass");
const crossHits = findBuyPoints(crossBars);
assert(crossHits.at(-1)?.time === crossBars[crossBars.length - 1].time, "the cross day is the latest screen hit");

const beforeCross = analyzeBars(barsFromCloses(crossCloses.slice(0, -1)))!;
assert(beforeCross.ma4CrossUpMa7 === false, "the day before has not crossed MA4 over MA7");
assert(beforeCross.aboveMa4 && beforeCross.aboveMa7, "the day before can already sit above both averages");
assert(beforeCross.ma7TurnUp === false, "MA7 has not turned up yet on the day before the cross");
assert(!passesScreen(beforeCross), "standing above without MA7 turning up should not pass");

const popped = crossCloses.slice(0, -2);
const poppedPrice = popped[popped.length - 1] * 1.06;
popped.push(Number(poppedPrice.toFixed(4)));
const poppedTech = analyzeBars(barsFromCloses(popped))!;
assert(poppedTech.ma4CrossUpMa7, "a sharp bounce can still cross MA4 over MA7");
assert(poppedTech.aboveMa4 && poppedTech.aboveMa7, "the sharp bounce close sits above both averages");
assert(poppedTech.ma4TurnUp && poppedTech.ma7TurnUp, "the sharp bounce also turns both averages up");
assert(poppedTech.standDays === 1, "the sharp bounce is the first qualified day");
assert(passesScreen(poppedTech), "a bounce that stands above turning MA4/MA7 should pass");

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
const flatLines = buildMaLines(flat);
assert(flatLines.signals.length === 0, "a flat tape has no moving-average trade");
assert(flatLines.points.at(-1)?.ma4 === 20 && flatLines.points.at(-1)?.ma7 === 20 && flatLines.points.at(-1)?.ma20 === 20, "flat closes sit on MA4, MA7 and MA20");

const maPop = [...Array.from({ length: 30 }, (_, i) => barAt(i, 10)), barAt(30, 12)];
const maPopLines = buildMaLines(maPop);
assert(maPopLines.signals.length === 1 && maPopLines.signals[0].side === "buy", "MA4 crossing above MA7 with the close above MA20 is a buy");
assert(maPopLines.points[30].ma4 != null && maPopLines.points[30].ma7 != null && maPopLines.points[30].ma4! > maPopLines.points[30].ma7!, "the buy bar has MA4 above MA7");

const roundTrip = [
  ...maPop,
  barAt(31, 10),
];
const roundTripLines = buildMaLines(roundTrip);
assert(roundTripLines.signals.map((item) => item.side).join(",") === "buy,sell", "falling back through MA20 sells the open trade");
assert(roundTripLines.signals[1].time === roundTrip[31].time, "the sell is the bar that breaks MA20");

const stillAbove = [
  ...maPop,
  ...Array.from({ length: 6 }, (_, i) => barAt(31 + i, 13)),
];
const held = buildMaLines(stillAbove);
assert(held.signals.length === 1 && held.signals[0].side === "buy", "holding above MA20 does not sell before a cross down");

const deathCross = [...stillAbove, barAt(37, 11.2)];
const death = buildMaLines(deathCross);
assert(death.signals.map((item) => item.side).join(",") === "buy,sell", "MA4 crossing back under MA7 sells while the close is still above MA20");
assert((death.points.at(-1)?.ma20 ?? 0) < 11.2, "that sell stays above MA20");
assert((death.points.at(-1)?.ma4 ?? 0) < (death.points.at(-1)?.ma7 ?? 0), "MA4 is back under MA7 on the sell");

const buried: KBar[] = [];
let buriedPrice = 20;
for (let i = 0; i < 40; i += 1) {
  buried.push(barAt(i, Number(buriedPrice.toFixed(4))));
  buriedPrice *= 0.99;
}
for (let i = 0; i < 3; i += 1) {
  buriedPrice *= 1.02;
  buried.push(barAt(buried.length, Number(buriedPrice.toFixed(4))));
}
const buriedLines = buildMaLines(buried);
const bounceBar = buriedLines.points[buried.length - 1];
assert(bounceBar.ma4 != null && bounceBar.ma7 != null && bounceBar.ma20 != null, "the bounce has all three averages");
assert(bounceBar.ma4 > bounceBar.ma7, "the bounce lifts MA4 through MA7");
assert(buried[buried.length - 1].close < bounceBar.ma20, "the bounce close is still under MA20");
assert(buriedLines.signals.length === 0, "a 4/7 cross under MA20 is not a buy, and a decline never sells from flat");

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
  cross: { ma4: cross.ma4.toFixed(3), ma7: cross.ma7.toFixed(3), hist: cross.hist.toFixed(4) },
});
