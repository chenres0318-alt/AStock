import { isEtf, priceDigits } from "./codes.ts";
import { formatPrice } from "./format.ts";
import {
  intradayExtremes,
  kdjSeries,
  linearSlope,
  markConfidence,
  pairSwingCovers,
  pickPriorCloses,
  positionIndex,
  sessionRangeAfter,
  macdfsSeries,
  recentVolumeAvg,
  tagTTrades,
  type IntradayMark,
  type IntradayMinute,
} from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function shapeExtremes(points: IntradayMinute[], options?: { etf?: boolean }) {
  return intradayExtremes(points, { ...options, openWithSwing: false, minConfidence: 0, openFirst: "either" });
}

function session(parts: Array<{ n: number; step: number }>, origin: number, avgAt?: (price: number, index: number) => number): IntradayMinute[] {
  const points: IntradayMinute[] = [];
  let price = origin;
  let sum = 0;
  for (const part of parts) {
    for (let i = 0; i < part.n; i += 1) {
      price = Math.round((price + part.step) * 100) / 100;
      sum += price;
      const minute = 9 * 60 + 30 + points.length;
      const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const avg = avgAt ? avgAt(price, points.length) : sum / (points.length + 1);
      points.push({ time, price, volume: 1000, avg });
    }
  }
  return points;
}

assert(pairSwingCovers(50, 50.74) === false, "1.48 percent on a stock pair is below the 1.5 percent swing");
assert(pairSwingCovers(50, 50.75) === true, "1.5 percent on a stock pair meets the swing floor");
assert(pairSwingCovers(50, 51) === true, "2 percent on a stock pair still covers the 1.5 percent floor");
assert(pairSwingCovers(10, 10.07) === false, "0.7 percent on a stock pair is below the 1.5 percent swing");
assert(pairSwingCovers(0.598, 0.602) === false, "a 0.67 percent move still fails the stock 1.5 percent floor");
assert(pairSwingCovers(0.598, 0.604, true) === true, "a 1 percent move covers the ETF 1 percent floor");
assert(pairSwingCovers(0.598, 0.603, true) === false, "0.84 percent on an ETF pair is below the 1 percent swing");
assert(pairSwingCovers(0.598, 0.602, true) === false, "0.67 percent on an ETF pair is below the 1 percent swing");
assert(pairSwingCovers(0.598, 0.601, true) === false, "0.5 percent on an ETF pair is below the 1 percent swing");
assert(pairSwingCovers(0.598, 0.59801, true) === false, "a 0.001 fen ETF pair is not a 1 percent swing");
assert(sessionRangeAfter([{ time: "09:30", price: 30, volume: 1, avg: 30 }]) == null, "the open auction window alone has no 9:45 range");
const afterOpen = sessionRangeAfter([
  { time: "09:30", price: 30, volume: 1, avg: 30 },
  { time: "09:44", price: 28, volume: 1, avg: 29 },
  { time: "09:45", price: 12, volume: 1, avg: 20 },
  { time: "10:00", price: 18, volume: 1, avg: 19 },
  { time: "15:01", price: 40, volume: 1, avg: 20 },
]);
assert(afterOpen != null && afterOpen.low === 12 && afterOpen.high === 18, "the 9:45 range ignores the open spike and the after-close print");
assert(positionIndex(12, afterOpen) === 0, "the session low is position 0");
assert(positionIndex(18, afterOpen) === 100, "the session high is position 100");
assert(positionIndex(15, afterOpen) === 50, "the midpoint of the 9:45 range is position 50");
assert(positionIndex(10, afterOpen) === 0, "a price below the 9:45 low clamps to 0");
assert(positionIndex(20, afterOpen) === 100, "a price above the 9:45 high clamps to 100");
assert(markConfidence("top", 82) === 82, "a top is more believable near the high");
assert(markConfidence("bottom", 82) === 18, "a bottom is less believable near the high");
assert(markConfidence("bottom", 8) === 92, "a bottom is more believable near the low");
assert(positionIndex(12, { high: 12, low: 12 }) == null, "a flat 9:45 range has no position index");
assert(isEtf("sz159516", "半导体设备ETF国泰"), "the Guotai semiconductor equipment fund is an ETF");
assert(isEtf("sh560780") && isEtf("sh588710"), "Shanghai ETF prefixes count without a name");
assert(!isEtf("sh601138", "工业富联"), "a stock is not scored as an ETF");
assert(priceDigits("sz159516", "半导体设备ETF国泰") === 3 && formatPrice(0.598, 3) === "0.598", "an ETF price keeps the 0.001 place");
assert(formatPrice(100.123, 3) === "100.123", "three decimals stay on an ETF price above 100");
assert(priceDigits("sh601138", "工业富联") === 2 && formatPrice(48.31) === "48.31", "a stock price stays at two decimals");
assert(formatPrice(0.598) === "0.60", "two decimals still round a third digit");
assert(shapeExtremes(session([{ n: 80, step: 0 }], 20)).length === 0, "a flat session has no top or bottom");

const easingRise = session(
  [
    { n: 40, step: 0 },
    { n: 6, step: 0.4 },
    { n: 6, step: 0.15 },
    { n: 8, step: -0.2 },
  ],
  20,
);
const topMarks = shapeExtremes(easingRise);
assert(topMarks[0]?.side === "top" && topMarks[0].time === "10:16", "a rise that is still up but slowing is a top");
assert(
  topMarks.length === 2 && topMarks[1].side === "bottom" && pairSwingCovers(topMarks[1].price, topMarks[0].price),
  "after that top, a 1.5 percent drop can mark the opposite bottom without a weakening-slope shape",
);
assert(Math.abs(topMarks[0].price - 22.55) < 1e-9, "the top is the minute both slopes and both short EMAs weaken");
const topPrices = easingRise.map((point) => point.price);
const topHist = macdfsSeries(topPrices).map((bar) => bar?.hist ?? Number.NaN);
const topPriceSlope = linearSlope(topPrices, topMarks[0].index);
const prevTopPriceSlope = linearSlope(topPrices, topMarks[0].index - 1);
const topHistSlope = linearSlope(topHist, topMarks[0].index);
const prevTopHistSlope = linearSlope(topHist, topMarks[0].index - 1);
assert(
  topPriceSlope != null &&
    prevTopPriceSlope != null &&
    topHistSlope != null &&
    prevTopHistSlope != null &&
    topPriceSlope > 0 &&
    topHistSlope > 0 &&
    topPriceSlope < prevTopPriceSlope &&
    topHistSlope < prevTopHistSlope,
  "the top keeps a positive slope on price and MACDFS, both smaller than the previous minute",
);
const topBar = macdfsSeries(topPrices)[topMarks[0].index];
assert(topBar != null && topBar.dif > topBar.dea, "the top is still inside DIF above DEA");

const easingDrop = session(
  [
    { n: 40, step: 0 },
    { n: 8, step: -0.35 },
    { n: 6, step: -0.08 },
    { n: 8, step: 0.2 },
  ],
  20,
);
const bottomMarks = shapeExtremes(easingDrop);
assert(bottomMarks[0]?.side === "bottom" && bottomMarks[0].time === "10:18", "a drop that is still down but slowing is a bottom");
assert(
  bottomMarks.length === 2 && bottomMarks[1].side === "top" && pairSwingCovers(bottomMarks[0].price, bottomMarks[1].price),
  "after that bottom, a 1.5 percent bounce can mark the opposite top without a weakening-slope shape",
);
assert(Math.abs(bottomMarks[0].price - 17.12) < 1e-9, "the bottom is the minute the decline weakens");
const bottomPrices = easingDrop.map((point) => point.price);
const bottomHist = macdfsSeries(bottomPrices).map((bar) => bar?.hist ?? Number.NaN);
const bottomPriceSlope = linearSlope(bottomPrices, bottomMarks[0].index);
const prevBottomPriceSlope = linearSlope(bottomPrices, bottomMarks[0].index - 1);
const bottomHistSlope = linearSlope(bottomHist, bottomMarks[0].index);
const prevBottomHistSlope = linearSlope(bottomHist, bottomMarks[0].index - 1);
assert(
  bottomPriceSlope != null &&
    prevBottomPriceSlope != null &&
    bottomHistSlope != null &&
    prevBottomHistSlope != null &&
    bottomPriceSlope < 0 &&
    bottomHistSlope < 0 &&
    bottomPriceSlope > prevBottomPriceSlope &&
    bottomHistSlope > prevBottomHistSlope,
  "the bottom keeps a negative slope, both closer to zero than the previous minute",
);
const bottomBar = macdfsSeries(bottomPrices)[bottomMarks[0].index];
assert(bottomBar != null && bottomBar.dea > bottomBar.dif, "the bottom is still inside DEA above DIF");

const higherTop = shapeExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 6, step: 0.4 },
      { n: 4, step: 0.1 },
      { n: 6, step: 0.45 },
      { n: 4, step: 0.12 },
    ],
    20,
  ),
);
assert(higherTop.length === 1 && higherTop[0].side === "top" && higherTop[0].time === "10:26", "a later higher top replaces the earlier top");
assert(Math.abs(higherTop[0].price - 25.62) < 1e-9, "the kept top is the higher one");

const lowerBottom = shapeExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 8, step: -0.35 },
      { n: 4, step: -0.05 },
      { n: 4, step: 0.01 },
      { n: 8, step: -0.3 },
      { n: 4, step: -0.04 },
    ],
    20,
  ),
);
assert(
  lowerBottom.length === 1 && lowerBottom[0].side === "bottom" && lowerBottom[0].time === "10:34",
  "a later lower bottom replaces the earlier bottom",
);
assert(Math.abs(lowerBottom[0].price - 14.6) < 1e-9, "the kept bottom is the lower one");

const paired = shapeExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 6, step: 0.4 },
      { n: 4, step: 0.1 },
      { n: 8, step: -0.3 },
      { n: 4, step: -0.05 },
    ],
    20,
  ),
);
assert(
  paired.length === 2 && paired[0].side === "top" && paired[1].side === "bottom",
  "a weakening drop after a top closes the pair when the swing is at least 1.5 percent",
);
assert(Math.abs(paired[0].price - 22.5) < 1e-9 && Math.abs(paired[1].price - 20.35) < 1e-9, "the pair keeps that top and that bottom");
assert(pairSwingCovers(paired[1].price, paired[0].price), "the kept stock pair has at least a 1.5 percent swing");
assert(paired[0].position != null && paired[0].position >= 80, "the kept top sits in the upper part of the 9:45 range");
assert(paired[1].position != null && paired[1].position <= 20, "the kept bottom sits in the lower part of the 9:45 range");
assert(paired[0].confidence === paired[0].position, "top confidence equals the position index");
assert(paired[1].confidence != null && paired[1].confidence === 100 - (paired[1].position as number), "bottom confidence is 100 minus the position index");

const dropThenBounce = [
  { n: 40, step: 0 },
  { n: 8, step: -0.35 },
  { n: 6, step: -0.08 },
];
const swingFromBottom = shapeExtremes(session([...dropThenBounce, { n: 1, step: 0.8 }], 20));
assert(
  swingFromBottom.length === 2 && swingFromBottom[0].side === "bottom" && swingFromBottom[1].side === "top",
  "a bounce after a morphological bottom marks a top even if the slope is not weakening",
);
assert(pairSwingCovers(swingFromBottom[0].price, swingFromBottom[1].price), "that bounce covers the stock 1.5 percent floor");
const shyBounce = shapeExtremes(session([...dropThenBounce, { n: 1, step: 0.2 }], 20));
assert(shyBounce.length === 1 && shyBounce[0].side === "bottom", "a bounce under 1.5 percent does not mint a stock top");
const etfBounce = shapeExtremes(session([...dropThenBounce, { n: 1, step: 0.6 }], 20), { etf: true });
assert(
  etfBounce.length === 2 && etfBounce[0].side === "bottom" && etfBounce[1].side === "top",
  "a 1 percent bounce after a morphological bottom is enough to pair an ETF top",
);
assert(shapeExtremes(session([...dropThenBounce, { n: 1, step: 0.1 }], 20), { etf: true }).length === 1, "a bounce under 1 percent does not mint an ETF top");

const steadyRise = shapeExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 20, step: 0.1 },
    ],
    20,
  ),
);
assert(steadyRise.length === 0, "a steady rise whose slope is not shrinking has no top");

const belowAvgTop = shapeExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 6, step: 0.4 },
      { n: 6, step: 0.15 },
    ],
    20,
    () => 40,
  ),
);
assert(
  belowAvgTop.length === 1 && belowAvgTop[0].side === "top" && belowAvgTop[0].price < 40,
  "a weakening rise below the average line is still a top while DIF stays above DEA",
);

const dropAboveAvg = shapeExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 8, step: -0.35 },
      { n: 6, step: -0.08 },
    ],
    20,
    () => 10,
  ),
);
assert(dropAboveAvg.every((mark) => mark.side !== "bottom"), "a weakening drop above the average line is not a bottom");

const huggingAvg = shapeExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 6, step: 0.4 },
      { n: 6, step: 0.15 },
    ],
    20,
    (price) => price - 0.02,
  ),
);
assert(
  huggingAvg.length === 1 && huggingAvg[0].side === "top",
  "a weakening rise two cents off the average line is still a top once the pair, not the average line, carries the cost rule",
);

const climb = Array.from({ length: 20 }, (_, i) => 10 + i);
const climbKdj = kdjSeries(climb);
assert(climbKdj[8] != null && Math.abs(climbKdj[8].j - 50) > 1, "KDJ starts moving once the 9-bar window fills");
assert(climbKdj.at(-1) != null && (climbKdj.at(-1) as { j: number }).j > 70, "a straight climb puts J in the overbought zone");
const dump = Array.from({ length: 20 }, (_, i) => 30 - i);
assert(kdjSeries(dump).at(-1) != null && (kdjSeries(dump).at(-1) as { j: number }).j < 30, "a straight dump puts J in the oversold zone");
const flatKdj = kdjSeries(Array.from({ length: 12 }, () => 10));
assert(flatKdj[8] != null && Math.abs(flatKdj[8].k - 50) < 1e-9 && Math.abs(flatKdj[8].j - 50) < 1e-9, "a flat tape keeps KDJ at 50");

assert(recentVolumeAvg(easingRise, 10) === 1000, "a flat tape keeps the recent volume average at 1000");
const dryRise = easingRise.map((point, index) => ({ ...point, volume: index >= topMarks[0].index ? 50 : 1000 }));
assert(shapeExtremes(dryRise).every((mark) => mark.side !== "top"), "a weakening rise on a dry tape is not a top");
const dumpBottom = easingDrop.map((point, index) => ({ ...point, volume: index >= bottomMarks[0].index ? 5000 : 1000 }));
assert(shapeExtremes(dumpBottom).every((mark) => mark.side !== "bottom"), "a weakening drop on a blow-off tape is not a bottom");
const silentDrop = easingDrop.map((point, index) => ({ ...point, volume: index >= bottomMarks[0].index ? 0 : 1000 }));
assert(shapeExtremes(silentDrop).every((mark) => mark.side !== "bottom"), "a minute with no volume is not a bottom");

const shyLiveRise = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 2, step: 0.1 },
    ],
    20,
  ),
);
assert(shyLiveRise.length === 0, "a 1 percent stock rise does not lock a bottom");
const justLiveRise = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 3, step: 0.1 },
    ],
    20,
  ),
);
assert(
  justLiveRise[0]?.side === "bottom" && justLiveRise.every((mark) => mark.side !== "top"),
  "a 1.5 percent stock rise locks the session low as a bottom, with no top until a 1.5 percent pullback",
);
const shyLiveDrop = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 2, step: -0.1 },
    ],
    20,
  ),
);
assert(shyLiveDrop.length === 0, "a 1 percent stock drop does not lock a top");
const justLiveDrop = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 3, step: -0.1 },
    ],
    20,
  ),
);
assert(justLiveDrop[0]?.side === "top" && justLiveDrop.every((mark) => mark.side !== "bottom"), "a 1.5 percent stock drop locks a top, with no bottom until a 1.5 percent bounce");

const liveTop = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 5, step: 0.1 },
    ],
    20,
  ),
);
assert(
  liveTop[0]?.side === "bottom" && liveTop[0].time === "09:45" && liveTop.every((mark) => mark.side !== "top"),
  "after 9:45 a 1.5 percent rise locks the session low as a bottom, but does not stamp a top until price pulls back 1.5 percent",
);
assert(liveTop.find((mark) => mark.side === "bottom")?.confidence === 100, "the locked bottom keeps 100 confidence against the range at confirmation");

const liveBottom = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 5, step: -0.1 },
    ],
    20,
  ),
);
assert(liveBottom.length >= 1 && liveBottom[0].side === "top" && liveBottom[0].time >= "09:45", "after 9:45 a 1.5 percent drop locks a top first, without waiting for MACD shape");
const liveBottomThenTop = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 5, step: -0.1 },
      { n: 5, step: 0.12 },
    ],
    20,
  ),
);
assert(
  liveBottomThenTop[0]?.side === "top" && liveBottomThenTop.some((mark) => mark.side === "bottom"),
  "after a locked top, a 1.5 percent bounce still marks the opposite bottom",
);

const beforeOpenRange = intradayExtremes(session([{ n: 14, step: 0.3 }], 20));
assert(
  beforeOpenRange.every((mark) => mark.time >= "09:45" || mark.side !== "top"),
  "a swing before 9:45 does not open the first top by the live rule",
);
assert(beforeOpenRange.filter((mark) => mark.time < "09:45").length === 0, "no swing-opened mark is stamped before 9:45");

const livePair = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 5, step: 0.1 },
      { n: 5, step: -0.12 },
    ],
    20,
  ),
);
assert(
  livePair[0]?.side === "bottom" && livePair.some((mark) => mark.side === "top"),
  "a rise then drop locks a bottom first, then locks the swing high as a top once price pulls back 1.5 percent",
);

const laterHigherHigh = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 5, step: 0.1 },
    { n: 5, step: -0.12 },
    { n: 20, step: 0.5 },
  ],
  20,
);
const midRangeKept = intradayExtremes(laterHigherHigh, { minConfidence: 0 });
const midRangeShown = intradayExtremes(laterHigherHigh);
const firstTopPrice = livePair.find((mark) => mark.side === "top")?.price;
const sessionLowPrice = Math.min(...laterHigherHigh.filter((point) => point.time >= "09:45").map((point) => point.price));
const sessionHighPrice = Math.max(...laterHigherHigh.filter((point) => point.time >= "09:45").map((point) => point.price));
assert(
  firstTopPrice != null &&
    midRangeKept.some((mark) => mark.side === "top" && Math.abs(mark.price - firstTopPrice) < 1e-9) &&
    midRangeKept.every((mark) => mark.side !== "top" || Math.abs(mark.price - sessionHighPrice) > 1e-9),
  "after a later higher high, a locked top stays at the confirmed swing high instead of walking to the session high",
);
assert(
  midRangeShown.every((mark) => mark.confidence != null && mark.confidence >= 70),
  "the watch chart hides tops and bottoms whose confidence is under 70",
);
assert(
  midRangeShown.some((mark) => mark.side === "bottom" && mark.confidence === 100 && Math.abs(mark.price - sessionLowPrice) < 1e-9),
  "the locked 9:45 bottom still shows because confirmation-time confidence stays at 100 even after the range expands",
);
assert(
  midRangeShown.some((mark) => mark.side === "top" && mark.confidence === 100 && firstTopPrice != null && Math.abs(mark.price - firstTopPrice) < 1e-9),
  "the locked top still shows at confirmation-time confidence 100, even though it is no longer the session high",
);

function withDeadline(points: IntradayMinute[], extra: Array<{ time: string; price: number }>): IntradayMinute[] {
  return [
    ...points,
    ...extra.map((item) => ({ time: item.time, price: item.price, volume: 1000, avg: item.price })),
  ];
}

const morningOnlyBottoms = withDeadline(laterHigherHigh, [{ time: "14:44", price: Math.max(...laterHigherHigh.map((point) => point.price)) }]);
assert(
  !morningOnlyBottoms.some((point) => point.time >= "14:45") &&
    intradayExtremes(morningOnlyBottoms).every((mark) => mark.origin !== "forced"),
  "before 14:45 a tape does not force a 14:45 sell top",
);

const dumpOnly = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 10, step: 0.05 },
  ],
  20,
);
const lastBottomPrice = dumpOnly.filter((point) => point.time >= "09:45").reduce((low, point) => Math.min(low, point.price), Infinity);
const liveAfterBottom = lastBottomPrice + 0.35;
const bottomsPastDeadline = withDeadline(dumpOnly, [
  { time: "14:42", price: liveAfterBottom },
  { time: "14:45", price: liveAfterBottom },
]);
const forcedSell = intradayExtremes(bottomsPastDeadline);
assert(
  forcedSell.some((mark) => mark.side === "bottom") &&
    forcedSell.some((mark) => mark.side === "top" && mark.origin === "forced" && mark.time === "14:45" && mark.price === liveAfterBottom),
  "after 14:45 a dump that still only shows bottoms marks a top at the current price if it is above the bottom",
);
const belowBottom = withDeadline(dumpOnly, [{ time: "14:45", price: lastBottomPrice - 0.5 }]);
assert(
  intradayExtremes(belowBottom).every((mark) => mark.origin !== "forced"),
  "after 14:45 a current price still under the bottom does not mint a forced sell top",
);
const insideWindow = withDeadline(dumpOnly, [
  { time: "14:45", price: liveAfterBottom },
  { time: "14:52", price: liveAfterBottom + 0.05 },
  { time: "14:53", price: liveAfterBottom + 0.06 },
  { time: "15:00", price: liveAfterBottom + 0.08 },
]);
const forcedInsideWindow = intradayExtremes(insideWindow);
assert(
  forcedInsideWindow.some((mark) => mark.side === "top" && mark.origin === "forced" && mark.time === "14:52" && mark.price === liveAfterBottom + 0.05) &&
    !forcedInsideWindow.some((mark) => mark.side === "top" && (mark.time === "14:53" || mark.time === "15:00")),
  "the forced top follows the latest price only through 14:52, not later prints",
);

const alreadyHasTop = intradayExtremes(
  withDeadline(
    session(
      [
        { n: 15, step: 0 },
        { n: 1, step: 0 },
        { n: 5, step: 0.1 },
        { n: 5, step: -0.12 },
      ],
      20,
    ),
    [{ time: "14:50", price: 20.1 }],
  ),
);
assert(
  alreadyHasTop.filter((mark) => mark.side === "top" && mark.origin !== "forced").length >= 1 &&
    alreadyHasTop.filter((mark) => mark.origin === "forced").length === 0,
  "14:50 does not stack a forced sell top when a locked 70 top is already visible",
);
const liveTopPastDeadline = withDeadline(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 5, step: 0.1 },
    ],
    20,
  ),
  [{ time: "14:50", price: 20.35 }],
);
assert(
  intradayExtremes(liveTopPastDeadline).some((mark) => mark.side === "bottom") &&
    intradayExtremes(liveTopPastDeadline).some((mark) => mark.side === "top" && mark.origin === "forced"),
  "a 1.5 percent live rise that never pulled back still only has a locked bottom, so 14:50 forces a sell top",
);
assert(
  intradayExtremes(liveTopPastDeadline).every((mark) => mark.side === "bottom" || mark.side === "top"),
  "14:50 no longer marks 清仓离场; the tape only keeps tops and bottoms",
);
const bottomThenLate = intradayExtremes(
  withDeadline(laterHigherHigh, [
    { time: "14:45", price: liveAfterBottom },
    { time: "14:50", price: liveAfterBottom },
  ]),
);
assert(
  bottomThenLate.some((mark) => mark.side === "bottom") && bottomThenLate.every((mark) => mark.time !== "14:50"),
  "a tape that already has a locked top does not add a 14:50 清仓 mark",
);

const etfPop = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 2, step: 0.06 },
  ],
  20,
);
const openSpikeDump = session(
  [
    { n: 1, step: 0 },
    { n: 10, step: 0.05 },
    { n: 5, step: -0.05 },
    { n: 15, step: -0.04 },
    { n: 12, step: -0.08 },
  ],
  20,
);
assert(
  openSpikeDump[0]?.time === "09:30" &&
    openSpikeDump.some((point) => point.time === "09:40" && point.price === 20.5) &&
    openSpikeDump.some((point) => point.time === "10:00"),
  "the open-spike tape pops 2.5 percent by 9:40 then dumps through 10:00",
);
assert(
  intradayExtremes(openSpikeDump).every((mark) => mark.time > "10:00") &&
    intradayExtremes(openSpikeDump, { minConfidence: 0 }).every((mark) => mark.time > "10:00"),
  "an opening spike that gives back half by 10:00 does not keep 9:30-10:00 top or bottom marks",
);
assert(
  intradayExtremes(openSpikeDump, { minConfidence: 0 }).some((mark) => mark.side === "top" && mark.time > "10:00") &&
    intradayExtremes(openSpikeDump, { minConfidence: 0 }).every((mark) => mark.side !== "bottom"),
  "after 10:00 the same dump locks a top instead of walking a bottom down the slide",
);

const etfLive = intradayExtremes(etfPop, { etf: true });
assert(etfLive.length === 0, "an ETF 0.6 percent pop is below the 1 percent floor, so it does not lock a live pair");
assert(intradayExtremes(etfPop).length === 0, "the same 0.6 percent pop is not enough to open a stock pair");
assert(shapeExtremes(etfPop, { etf: true }).length === 0, "without the live swing door that small ETF pop is not a shape top");

const etfPair = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 4, step: 0.06 },
    { n: 4, step: -0.07 },
  ],
  20,
);
const etfPairMarks = intradayExtremes(etfPair, { etf: true });
assert(
  etfPairMarks[0]?.side === "bottom" && etfPairMarks.some((mark) => mark.side === "top"),
  "an ETF 1.2 percent rise then 1 percent pullback locks a bottom then a top",
);

const coldOpen = Array.from({ length: 40 }, (_, i) => 10 + i * 0.01);
assert(macdfsSeries(coldOpen)[32] == null, "without yesterday bars MACDFS is still warming at the 33rd minute");
assert(macdfsSeries(coldOpen)[33] != null, "MACDFS(12,26,9) first prints on the 34th minute of a cold open");

const prior40 = Array.from({ length: 40 }, (_, i) => 20 + Math.sin(i / 4) * 0.3);
const todayOpen = [20.4, 20.5, 20.45, 20.6];
const seeded = macdfsSeries(todayOpen, prior40);
const combined = macdfsSeries([...prior40, ...todayOpen]);
assert(seeded[0] != null, "40 prior 1-minute closes seed EMA so today's 9:30 already has MACDFS");
assert(
  seeded.every((bar, index) => {
    const full = combined[prior40.length + index];
    return bar != null && full != null && Math.abs(bar.dif - full.dif) < 1e-12 && Math.abs(bar.dea - full.dea) < 1e-12;
  }),
  "today's MACDFS continues from yesterday's ending EMA rather than restarting",
);

const prior26 = Array.from({ length: 26 }, () => 15);
assert(macdfsSeries(todayOpen, prior26)[0] == null, "26 prior closes warm EMA26 but DEA still needs a few more minutes");
assert(macdfsSeries(todayOpen, Array.from({ length: 34 }, () => 15))[0] != null, "34 prior closes also seed DEA so 9:30 has a histogram");

const mkline = [
  ...Array.from({ length: 50 }, (_, i) => ({ date: "20261022", close: 10 + i * 0.01 })),
  ...Array.from({ length: 10 }, (_, i) => ({ date: "20261023", close: 11 + i * 0.01 })),
];
const picked = pickPriorCloses(mkline, "20261023");
assert(picked.length === 40 && picked[0] === 10.1 && picked.at(-1) === 10.49, "prior closes take the last 40 bars of the previous session");
assert(pickPriorCloses(mkline.slice(0, 20), "20261023").length === 0, "fewer than 26 prior bars are not used as an EMA seed");
assert(pickPriorCloses(mkline, "2026-10-23").length === 40, "a dashed trade date still selects yesterday's closes");

const rallyFromOpenRange = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 12, step: 0.04 },
  ],
  20,
);
const rallyMarks = intradayExtremes(rallyFromOpenRange);
assert(
  rallyMarks.some((mark) => mark.side === "bottom" && mark.time === "09:45" && mark.confidence === 100) &&
    rallyMarks.every((mark) => mark.side !== "top"),
  "a 9:45 low that then rallies 1.5 percent locks that past low as a bottom, and waits for a 1.5 percent pullback before locking a top",
);

function tMark(
  index: number,
  time: string,
  side: IntradayMark["side"],
  price: number,
  extra: Partial<IntradayMark> = {},
): IntradayMark {
  return {
    index,
    time,
    side,
    price,
    position: side === "top" ? 80 : 20,
    confidence: 80,
    origin: "shape",
    ...extra,
  };
}

const pairedT = tagTTrades([tMark(40, "10:10", "bottom", 10), tMark(80, "10:50", "top", 10.25)]);
assert(pairedT.map((mark) => mark.t).join(",") === "t-buy,t-sell", "a 10:00+ bottom then a paired 1.5%+ top is T-buy then T-sell");

assert(
  tagTTrades([tMark(50, "10:20", "top", 11)])[0]?.t === "t-sell",
  "a locked top after 10:00 can T-sell first, so overnight longs can sell then buy back",
);

assert(
  tagTTrades([tMark(18, "09:47", "top", 13.3, { confirmTime: "09:53", confirmPrice: 13.07 })])[0]?.t === "t-sell",
  "a top that locks after 9:45 can T-sell before 10:00; only new T-buys wait until 10:00",
);

assert(
  tagTTrades([tMark(20, "09:50", "bottom", 10)])[0]?.t === "ignore",
  "a bottom before 10:00 is not a T-buy",
);

assert(
  tagTTrades([tMark(20, "09:50", "bottom", 10, { confirmTime: "10:05", confirmPrice: 10.2 })])[0]?.t === "t-buy",
  "a pre-10:00 low that only locks after 10:00 can still T-buy at confirmation",
);

assert(
  tagTTrades([tMark(50, "10:20", "top", 11), tMark(80, "10:50", "bottom", 11.2)])[1]?.t === "ignore",
  "a buyback at or above the T-sell fill is not a T-rebuy",
);

assert(
  tagTTrades([tMark(50, "10:20", "top", 11), tMark(80, "10:50", "bottom", 10.5)])[1]?.t === "t-rebuy",
  "a buyback below the T-sell fill is a T-rebuy",
);

assert(
  tagTTrades([tMark(200, "14:10", "bottom", 10)])[0]?.t === "ignore",
  "a bottom after 14:00 is not a new T",
);

const stacked = tagTTrades([
  tMark(40, "10:10", "bottom", 10),
  tMark(50, "10:20", "bottom", 9.9),
  tMark(80, "10:50", "top", 10.25),
]);
assert(
  stacked.map((mark) => mark.t).join(",") === "t-buy,ignore,t-sell",
  "a second bottom while already in the T is not an add; the paired top still sells",
);

const twoLaps = tagTTrades([
  tMark(40, "10:10", "bottom", 10),
  tMark(80, "10:50", "top", 10.25),
  tMark(140, "13:10", "bottom", 10.05),
  tMark(170, "13:40", "top", 10.3),
]);
assert(
  twoLaps.map((mark) => mark.t).join(",") === "t-buy,t-sell,t-rebuy,t-sell",
  "after a T-sell the next bottom before 14:00 is a buyback, then the next paired top sells again",
);

const thinTop = tagTTrades([tMark(40, "10:10", "bottom", 10), tMark(80, "10:50", "top", 10.06)]);
assert(thinTop[1]?.t === "ignore", "a top that does not cover the 1.5 percent pair swing is not a T-sell");

const forced = tagTTrades([
  tMark(40, "10:10", "bottom", 10),
  tMark(230, "14:48", "top", 10.3, { origin: "forced" }),
]);
assert(
  forced.map((mark) => mark.t).join(",") === "t-buy,flatten",
  "the 14:45 forced sell top flattens instead of counting as a T-sell",
);

const liveForcedT = tagTTrades(forcedSell);
assert(
  liveForcedT.some((mark) => mark.origin === "forced" && mark.t === "flatten") &&
    liveForcedT.filter((mark) => mark.side === "bottom" && mark.time < "10:00").every((mark) => mark.t === "ignore"),
  "14:45 补顶 flattens, and a bottom still inside the 9:30-10:00 dump window is not a T-buy",
);

const forcedRebuyTagged = tagTTrades([
  tMark(50, "10:20", "top", 11),
  tMark(240, "14:55", "bottom", 10.5, { origin: "forced", confirmTime: "14:55", confirmPrice: 10.5 }),
]);
assert(
  forcedRebuyTagged.map((mark) => mark.t).join(",") === "t-sell,t-rebuy",
  "a 14:55 forced bottom after a T-sell is a T-rebuy even after 14:00",
);

const soldThenLate = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 5, step: 0.1 },
    { n: 5, step: -0.12 },
  ],
  20,
);
const beforeRebuyDeadline = withDeadline(soldThenLate, [{ time: "14:54", price: 19.4 }]);
assert(
  intradayExtremes(beforeRebuyDeadline).every((mark) => mark.origin !== "forced" || mark.side !== "bottom"),
  "before 14:55 a T-sell with no later bottom does not mint a rebuy bottom",
);
const soldNoBottom = withDeadline(soldThenLate, [
  { time: "14:54", price: 19.4 },
  { time: "14:55", price: 19.3 },
  { time: "15:00", price: 19.1 },
]);
const soldNoBottomMarks = intradayExtremes(soldNoBottom);
const soldNoBottomT = tagTTrades(soldNoBottomMarks);
assert(
  soldNoBottomMarks.some((mark) => mark.side === "top" && mark.origin !== "forced") &&
    soldNoBottomMarks.some((mark) => mark.side === "bottom" && mark.origin === "forced" && mark.time === "14:55" && mark.price === 19.3) &&
    !soldNoBottomMarks.some((mark) => mark.side === "bottom" && mark.time === "15:00"),
  "at 14:55 a T-sell with no later bottom marks a rebuy bottom at 14:55, not at 15:00",
);
assert(
  soldNoBottomT.some((mark) => mark.t === "t-sell") &&
    soldNoBottomT.some((mark) => mark.side === "bottom" && mark.origin === "forced" && mark.t === "t-rebuy"),
  "the 14:55 forced bottom is a T-rebuy below the T-sell fill",
);
const rebuyTooHigh = withDeadline(soldThenLate, [{ time: "14:55", price: 20.45 }]);
assert(
  intradayExtremes(rebuyTooHigh).every((mark) => mark.origin !== "forced" || mark.side !== "bottom"),
  "14:55 does not rebuy at or above the T-sell fill",
);
const forceTopThenLate = withDeadline(dumpOnly, [
  { time: "14:45", price: liveAfterBottom },
  { time: "14:55", price: liveAfterBottom - 0.1 },
]);
assert(
  intradayExtremes(forceTopThenLate).some((mark) => mark.side === "top" && mark.origin === "forced") &&
    intradayExtremes(forceTopThenLate).every((mark) => mark.side !== "bottom" || mark.origin !== "forced"),
  "a 14:45 补顶 is not a T-sell, so 14:55 does not mint a rebuy bottom",
);
const soldThenIgnoredBottom = withDeadline(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 5, step: -0.1 },
      { n: 5, step: 0.12 },
    ],
    20,
  ),
  [{ time: "14:55", price: 18.6 }],
);
const soldThenIgnoredMarks = intradayExtremes(soldThenIgnoredBottom);
const soldThenIgnoredT = tagTTrades(soldThenIgnoredMarks);
assert(
  soldThenIgnoredMarks.some((mark) => mark.side === "top" && mark.origin !== "forced") &&
    soldThenIgnoredMarks.some((mark) => mark.side === "bottom" && mark.origin !== "forced") &&
    soldThenIgnoredT.some((mark) => mark.t === "t-sell") &&
    soldThenIgnoredT.some((mark) => mark.side === "bottom" && mark.origin !== "forced" && mark.t === "ignore"),
  "a bounce after a T-sell can still lock a bottom that is too expensive to 接回",
);
assert(
  soldThenIgnoredMarks.some((mark) => mark.side === "bottom" && mark.origin === "forced" && mark.time === "14:55" && mark.price === 18.6) &&
    soldThenIgnoredT.some((mark) => mark.origin === "forced" && mark.t === "t-rebuy"),
  "14:55 still 接回 when earlier bottoms after the T-sell were ignore",
);

const grindDown = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 40, step: -0.02 },
  ],
  20,
);
const grindMarks = intradayExtremes(grindDown);
assert(
  grindMarks.filter((mark) => mark.side === "top").length === 1 &&
    grindMarks.every((mark) => mark.side !== "bottom") &&
    tagTTrades(grindMarks).every((mark) => mark.t !== "t-buy" && mark.t !== "t-rebuy"),
  "a one-way grind lower locks a single top and does not keep reprinting T-buy bottoms",
);
const grindPrefix = grindDown.slice(0, 36);
const grindLater = grindDown.slice(0, 56);
assert(
  (intradayExtremes(grindPrefix).find((mark) => mark.side === "top")?.price ?? 0) ===
    (intradayExtremes(grindLater).find((mark) => mark.side === "top")?.price ?? 1),
  "the locked grind top does not walk down as later lows print",
);
const grindUntilRebuy = withDeadline(grindDown, [{ time: "14:55", price: 18.8 }]);
const grindUntilRebuyMarks = intradayExtremes(grindUntilRebuy);
assert(
  grindUntilRebuyMarks.some((mark) => mark.side === "top") &&
    grindUntilRebuyMarks.some((mark) => mark.side === "bottom" && mark.origin === "forced" && mark.time === "14:55" && mark.price === 18.8) &&
    tagTTrades(grindUntilRebuyMarks).some((mark) => mark.origin === "forced" && mark.t === "t-rebuy"),
  "a grind that T-sold the top and never bounced 1.5 percent still 接回 at 14:55",
);

console.log(
  "intradayExtreme.check ok",
  topMarks.map((mark) => `${mark.side}@${mark.price}`),
);
