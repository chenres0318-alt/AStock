import { isEtf, priceDigits } from "./codes.ts";
import { formatPrice } from "./format.ts";
import {
  intradayExtremes,
  kdjSeries,
  linearSlope,
  lotSpreadCoversCost,
  macdfsSeries,
  recentVolumeAvg,
  type IntradayMinute,
} from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
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

assert(lotSpreadCoversCost(10, 10.04) === false, "four cents does not cover 5 yuan, stamp tax, and 0.05");
assert(lotSpreadCoversCost(10, 10.055) === false, "5.5 yuan on one lot still falls short of 5 plus stamp plus 0.05");
assert(lotSpreadCoversCost(10, 10.06) === true, "six cents on one lot covers 5 yuan, stamp tax, and 0.05");
assert(lotSpreadCoversCost(0.598, 0.62) === false, "an ETF-sized move still fails when the stock 5 yuan minimum applies");
assert(lotSpreadCoversCost(0.598, 0.62, true) === true, "an ETF pair only needs 0.005% commission, with no 5 yuan floor");
assert(lotSpreadCoversCost(0.598, 0.59801, true) === false, "a 0.001 fen ETF pair does not cover 0.005% commission");
assert(isEtf("sz159516", "半导体设备ETF国泰"), "the Guotai semiconductor equipment fund is an ETF");
assert(isEtf("sh560780") && isEtf("sh588710"), "Shanghai ETF prefixes count without a name");
assert(!isEtf("sh601138", "工业富联"), "a stock keeps the 5 yuan minimum");
assert(priceDigits("sz159516", "半导体设备ETF国泰") === 3 && formatPrice(0.598, 3) === "0.598", "an ETF price keeps the 0.001 place");
assert(formatPrice(100.123, 3) === "100.123", "three decimals stay on an ETF price above 100");
assert(priceDigits("sh601138", "工业富联") === 2 && formatPrice(48.31) === "48.31", "a stock price stays at two decimals");
assert(formatPrice(0.598) === "0.60", "two decimals still round a third digit");
assert(intradayExtremes(session([{ n: 80, step: 0 }], 20)).length === 0, "a flat session has no top or bottom");

const easingRise = session(
  [
    { n: 40, step: 0 },
    { n: 6, step: 0.4 },
    { n: 6, step: 0.15 },
    { n: 8, step: -0.2 },
  ],
  20,
);
const topMarks = intradayExtremes(easingRise);
assert(topMarks.length === 1 && topMarks[0].side === "top" && topMarks[0].time === "10:16", "a rise that is still up but slowing is a top");
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
const bottomMarks = intradayExtremes(easingDrop);
assert(
  bottomMarks.length === 1 && bottomMarks[0].side === "bottom" && bottomMarks[0].time === "10:18",
  "a drop that is still down but slowing is a bottom",
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

const higherTop = intradayExtremes(
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

const lowerBottom = intradayExtremes(
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

const paired = intradayExtremes(
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
  "a weakening drop after a top closes the pair when one lot covers the T cost",
);
assert(Math.abs(paired[0].price - 22.5) < 1e-9 && Math.abs(paired[1].price - 20.35) < 1e-9, "the pair keeps that top and that bottom");
assert(lotSpreadCoversCost(paired[1].price, paired[0].price), "the kept stock pair covers 5 yuan, stamp tax, and 0.05");

const steadyRise = intradayExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 20, step: 0.1 },
    ],
    20,
  ),
);
assert(steadyRise.length === 0, "a steady rise whose slope is not shrinking has no top");

const belowAvgTop = intradayExtremes(
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

const dropAboveAvg = intradayExtremes(
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

const huggingAvg = intradayExtremes(
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
assert(intradayExtremes(dryRise).every((mark) => mark.side !== "top"), "a weakening rise on a dry tape is not a top");
const dumpBottom = easingDrop.map((point, index) => ({ ...point, volume: index >= bottomMarks[0].index ? 5000 : 1000 }));
assert(intradayExtremes(dumpBottom).every((mark) => mark.side !== "bottom"), "a weakening drop on a blow-off tape is not a bottom");
const silentDrop = easingDrop.map((point, index) => ({ ...point, volume: index >= bottomMarks[0].index ? 0 : 1000 }));
assert(intradayExtremes(silentDrop).every((mark) => mark.side !== "bottom"), "a minute with no volume is not a bottom");

console.log(
  "intradayExtreme.check ok",
  topMarks.map((mark) => `${mark.side}@${mark.price}`),
);
