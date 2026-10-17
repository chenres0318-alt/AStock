import { intradayExtremes, lotSpreadCoversCost, macdfsSeries, type IntradayMinute } from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function session(parts: Array<{ n: number; step: number }>, origin: number): IntradayMinute[] {
  const points: IntradayMinute[] = [];
  let price = origin;
  for (const part of parts) {
    for (let i = 0; i < part.n; i += 1) {
      price = Math.round((price + part.step) * 100) / 100;
      const minute = 9 * 60 + 30 + points.length;
      const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      points.push({ time, price, volume: 1000 });
    }
  }
  return points;
}

function down3(values: number[], index: number) {
  return values[index] < values[index - 1] && values[index - 1] < values[index - 2] && values[index - 2] < values[index - 3];
}

function up3(values: number[], index: number) {
  return values[index] > values[index - 1] && values[index - 1] > values[index - 2] && values[index - 2] > values[index - 3];
}

assert(lotSpreadCoversCost(10, 10.04) === false, "four cents does not cover a 5 yuan commission plus stamp tax");
assert(lotSpreadCoversCost(10, 10.06) === true, "six cents on one lot covers the commission and stamp tax");
assert(intradayExtremes(session([{ n: 80, step: 0 }], 20)).length === 0, "a flat session has no top or bottom");

const slowTop = session(
  [
    { n: 40, step: 0 },
    { n: 12, step: 0.2 },
    { n: 8, step: -0.04 },
  ],
  20,
);
const topMarks = intradayExtremes(slowTop);
assert(topMarks.length === 1 && topMarks[0].side === "top" && topMarks[0].time === "10:27", "three minutes of DIF falling and DEA rising mark a top");
assert(Math.abs(topMarks[0].price - 22.16) < 1e-9, "the top is the minute the three-minute rollover completes");
const topMacd = macdfsSeries(slowTop.map((point) => point.price));
const topDif = topMacd.map((bar) => bar?.dif ?? Number.NaN);
const topDea = topMacd.map((bar) => bar?.dea ?? Number.NaN);
const topHist = topMacd.map((bar) => bar?.hist ?? Number.NaN);
assert(down3(topDif, topMarks[0].index) && up3(topDea, topMarks[0].index) && down3(topHist, topMarks[0].index), "the top has DIF and the red column shrinking while DEA expands");
assert(topDif[topMarks[0].index] > topDea[topMarks[0].index], "the top is still before DIF crosses below DEA");
assert(topDif[topMarks[0].index] > 0 && topDea[topMarks[0].index] > 0, "this top is above the zero axis");

const slowBottom = session(
  [
    { n: 40, step: 0 },
    { n: 10, step: -0.15 },
    { n: 6, step: 0.04 },
  ],
  20,
);
const bottomMarks = intradayExtremes(slowBottom);
assert(
  bottomMarks.length === 1 && bottomMarks[0].side === "bottom" && bottomMarks[0].time === "10:23",
  "DEA shrinking for three minutes and DIF turning up mark a bottom",
);
assert(Math.abs(bottomMarks[0].price - 18.66) < 1e-9, "the bottom is the minute DIF hooks up");
const bottomMacd = macdfsSeries(slowBottom.map((point) => point.price));
const bottomBar = bottomMacd[bottomMarks[0].index];
const prevBottom = bottomMacd[bottomMarks[0].index - 1];
assert(bottomBar != null && prevBottom != null && bottomBar.dea > bottomBar.dif, "the bottom is still before DIF crosses above DEA");
assert(bottomBar.dif < 0 && bottomBar.dea < 0, "a bottom can sit below the zero axis");
assert(bottomBar.dif > prevBottom.dif && bottomBar.hist > prevBottom.hist, "DIF has turned up and the green column is weakening");

const replaced = intradayExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 12, step: 0.25 },
      { n: 10, step: -0.2 },
      { n: 4, step: 0.03 },
      { n: 8, step: -0.15 },
      { n: 6, step: 0.05 },
    ],
    20,
  ),
);
assert(
  replaced.length === 2 && replaced[0].side === "top" && replaced[1].side === "bottom",
  "a later lower bottom replaces the earlier bottom",
);
assert(Math.abs(replaced[0].price - 22.2) < 1e-9 && Math.abs(replaced[1].price - 20.12) < 1e-9, "the kept bottom is the lower one");

const quickDrop = intradayExtremes(
  session(
    [
      { n: 40, step: 0 },
      { n: 6, step: 0.05 },
      { n: 8, step: -0.08 },
    ],
    20,
  ),
);
assert(quickDrop.length === 0, "a fast drop does not mark a top unless DEA keeps expanding for three minutes");

console.log(
  "intradayExtreme.check ok",
  topMarks.map((mark) => `${mark.side}@${mark.price}`),
);
