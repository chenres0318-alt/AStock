import { isEtf, priceDigits } from "./codes.ts";
import { formatPrice } from "./format.ts";
import {
  intradayExtremes,
  kdjSeries,
  linearSlope,
  markConfidence,
  pairSwingCovers,
  positionIndex,
  sessionRangeAfter,
  macdfsSeries,
  recentVolumeAvg,
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

assert(pairSwingCovers(10, 10.14) === false, "1.4 percent on a stock pair is below the 1.5 percent swing");
assert(pairSwingCovers(10, 10.15) === true, "1.5 percent on a stock pair meets the swing floor");
assert(pairSwingCovers(0.598, 0.604) === false, "a 1 percent ETF-sized move still fails the stock 1.5 percent floor");
assert(pairSwingCovers(0.598, 0.604, true) === true, "the same 1 percent move covers the ETF 0.5 percent floor");
assert(pairSwingCovers(0.598, 0.6009, true) === false, "0.48 percent on an ETF pair is below the 0.5 percent swing");
assert(pairSwingCovers(0.598, 0.601, true) === true, "just over 0.5 percent on an ETF pair meets the swing floor");
assert(pairSwingCovers(0.598, 0.59801, true) === false, "a 0.001 fen ETF pair is not a 0.5 percent swing");
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
  "a 1.5 percent bounce after a morphological bottom marks a top even if the slope is not weakening",
);
assert(pairSwingCovers(swingFromBottom[0].price, swingFromBottom[1].price), "that bounce covers the stock 1.5 percent floor");
const shyBounce = shapeExtremes(session([...dropThenBounce, { n: 1, step: 0.5 }], 20));
assert(shyBounce.length === 1 && shyBounce[0].side === "bottom", "a bounce under 1.5 percent does not mint a stock top");
const etfBounce = shapeExtremes(session([...dropThenBounce, { n: 1, step: 0.5 }], 20), { etf: true });
assert(
  etfBounce.length === 2 && etfBounce[0].side === "bottom" && etfBounce[1].side === "top",
  "the same 0.5 yuan bounce is enough to pair an ETF top at the 0.5 percent floor",
);

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

const liveTop = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 4, step: 0.1 },
    ],
    20,
  ),
);
assert(liveTop.every((mark) => mark.side !== "top"), "a 1.5 percent rise after 9:45 does not open a top before a bottom");

const liveBottom = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 4, step: -0.1 },
    ],
    20,
  ),
);
assert(liveBottom.length >= 1 && liveBottom[0].side === "bottom" && liveBottom[0].time >= "09:45", "after 9:45 a 1.5 percent drop can open a bottom without waiting for MACD shape");
const liveBottomThenTop = intradayExtremes(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 4, step: -0.1 },
      { n: 4, step: 0.12 },
    ],
    20,
  ),
);
assert(
  liveBottomThenTop[0]?.side === "bottom" && liveBottomThenTop.some((mark) => mark.side === "top"),
  "after a live bottom, a 1.5 percent bounce still marks the opposite top",
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
      { n: 4, step: 0.1 },
      { n: 4, step: -0.12 },
    ],
    20,
  ),
);
assert(
  livePair.some((mark) => mark.side === "bottom") && livePair.every((mark) => mark.side !== "top"),
  "a rise then drop opens a bottom first and does not keep the early top",
);

const laterHigherHigh = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 4, step: 0.1 },
    { n: 4, step: -0.12 },
    { n: 20, step: 0.5 },
  ],
  20,
);
const midRangeKept = intradayExtremes(laterHigherHigh, { minConfidence: 0 });
const midRangeShown = intradayExtremes(laterHigherHigh);
assert(
  midRangeKept.some((mark) => mark.side === "top" && mark.confidence != null && mark.confidence < 70),
  "after a later higher high, the earlier top sits mid-range and falls below 70 confidence",
);
assert(
  midRangeShown.every((mark) => mark.confidence != null && mark.confidence >= 70),
  "the watch chart hides tops and bottoms whose confidence is under 70",
);
assert(
  midRangeShown.some((mark) => mark.side === "bottom" && mark.confidence === 100),
  "the session-low bottom still shows because its confidence stays at 100",
);
assert(
  midRangeShown.every((mark) => mark.side !== "top"),
  "the mid-range top is not marked once confidence is below 70",
);

function withDeadline(points: IntradayMinute[], extra: Array<{ time: string; price: number }>): IntradayMinute[] {
  return [
    ...points,
    ...extra.map((item) => ({ time: item.time, price: item.price, volume: 1000, avg: item.price })),
  ];
}

const morningOnlyBottoms = withDeadline(laterHigherHigh, [{ time: "14:49", price: Math.max(...laterHigherHigh.map((point) => point.price)) }]);
assert(
  !morningOnlyBottoms.some((point) => point.time >= "14:50") &&
    intradayExtremes(morningOnlyBottoms).every((mark) => mark.side !== "top"),
  "before 14:50 a tape with only bottoms does not force a sell top",
);

const lateHigh = Math.max(...laterHigherHigh.map((point) => point.price)) + 2;
const bottomsPastDeadline = withDeadline(laterHigherHigh, [
  { time: "14:42", price: lateHigh },
  { time: "14:50", price: lateHigh - 0.2 },
]);
const forcedSell = intradayExtremes(bottomsPastDeadline);
assert(
  forcedSell.some((mark) => mark.side === "bottom") &&
    forcedSell.some((mark) => mark.side === "top" && mark.time === "14:42" && mark.price === lateHigh),
  "at 14:50 a tape that still only shows bottoms must mark a sell top at the high by 14:50",
);
assert(
  (forcedSell.find((mark) => mark.side === "top")?.confidence ?? 0) >= 70,
  "the forced 14:50 sell top sits at the high so confidence stays at least 70",
);
const closeHigher = withDeadline(laterHigherHigh, [
  { time: "14:42", price: lateHigh },
  { time: "14:50", price: lateHigh - 0.2 },
  { time: "15:00", price: lateHigh + 1 },
]);
assert(
  intradayExtremes(closeHigher).some((mark) => mark.side === "top" && mark.time === "14:42" && mark.price === lateHigh),
  "a higher 15:00 print does not move the forced sell top off the 14:50 high",
);

const alreadyHasTop = intradayExtremes(
  withDeadline(
    session(
      [
        { n: 15, step: 0 },
        { n: 1, step: 0 },
        { n: 4, step: 0.1 },
        { n: 4, step: -0.12 },
      ],
      20,
    ),
    [{ time: "14:50", price: 20.1 }],
  ),
);
assert(
  alreadyHasTop.filter((mark) => mark.side === "top").length <= 1,
  "14:50 does not stack a second sell top when a 70 top is already visible",
);
const liveTopPastDeadline = withDeadline(
  session(
    [
      { n: 15, step: 0 },
      { n: 1, step: 0 },
      { n: 4, step: 0.1 },
    ],
    20,
  ),
  [{ time: "14:50", price: 20.2 }],
);
assert(
  intradayExtremes(liveTopPastDeadline).every((mark) => mark.side !== "top" && mark.side !== "clear"),
  "a top-first tape without a bottom and without daily MA confirmation does not force a top or a clear at 14:50",
);
const clearExit = intradayExtremes(liveTopPastDeadline, { belowDailyMa4AndMa7: true });
assert(
  clearExit.some((mark) => mark.side === "clear" && mark.time === "14:50") && clearExit.every((mark) => mark.side !== "top"),
  "a top-first tape that is below daily MA4 and MA7 marks 清仓离场 at 14:50",
);

const etfPop = session(
  [
    { n: 15, step: 0 },
    { n: 1, step: 0 },
    { n: 2, step: 0.06 },
  ],
  20,
);
assert(intradayExtremes(etfPop, { etf: true }).every((mark) => mark.side !== "top"), "an ETF also waits for a bottom before marking a top");
assert(intradayExtremes(etfPop).length === 0, "the same 0.6 percent pop is not enough to open a stock top");
assert(shapeExtremes(etfPop, { etf: true }).length === 0, "without the live swing door that small ETF pop is not a shape top");

console.log(
  "intradayExtreme.check ok",
  topMarks.map((mark) => `${mark.side}@${mark.price}`),
);
