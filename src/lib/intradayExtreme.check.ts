import { intradayExtremes, lotSpreadCoversCost, type IntradayMinute } from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function build(parts: Array<{ n: number; step: number; volume: number }>, origin: number): IntradayMinute[] {
  const points: IntradayMinute[] = [];
  let price = origin;
  for (const part of parts) {
    for (let i = 0; i < part.n; i += 1) {
      price = Math.round((price + part.step) * 100) / 100;
      points.push({ time: `t${points.length}`, price, volume: part.volume });
    }
  }
  return points;
}

const riseThenDrop = [
  { n: 40, step: 0, volume: 1000 },
  { n: 6, step: 0.25, volume: 9000 },
  { n: 6, step: 0.25, volume: 2000 },
  { n: 3, step: -0.15, volume: 1400 },
  { n: 8, step: -0.3, volume: 9000 },
  { n: 6, step: -0.3, volume: 1800 },
  { n: 3, step: 0.2, volume: 1200 },
];

assert(lotSpreadCoversCost(10, 10.04) === false, "four cents does not cover a 5 yuan commission plus stamp tax");
assert(lotSpreadCoversCost(10, 10.06) === true, "six cents on one lot covers the commission and stamp tax");
assert(intradayExtremes(build([{ n: 80, step: 0, volume: 1000 }], 10)).length === 0, "a flat session has no top or bottom");
assert(
  intradayExtremes(build(riseThenDrop.map((part) => ({ ...part, volume: 1000 })), 20)).length === 0,
  "a swing with no volume fade has no top or bottom",
);

const marks = intradayExtremes(build(riseThenDrop, 20));
assert(marks.length === 2 && marks[0].side === "top" && marks[1].side === "bottom", "a top can be marked before any bottom");
assert(Math.abs(marks[0].price - 23) < 1e-9, "the top is the price where the red column turns");
assert(Math.abs(marks[1].price - 18.35) < 1e-9, "the bottom is the price where the green column turns");
assert(lotSpreadCoversCost(marks[1].price, marks[0].price), "the pair clears the one-lot cost");

const replaced = intradayExtremes(
  build(
    [
      ...riseThenDrop.slice(0, -1),
      { n: 12, step: 0.2, volume: 2500 },
      { n: 8, step: -0.35, volume: 8000 },
      { n: 5, step: -0.25, volume: 1500 },
      { n: 3, step: 0.2, volume: 1100 },
    ],
    20,
  ),
);
assert(
  replaced.length === 2 && replaced[0].side === "top" && replaced[1].side === "bottom",
  "a later lower bottom replaces the earlier bottom",
);
assert(Math.abs(replaced[0].price - 23) < 1e-9 && Math.abs(replaced[1].price - 16.7) < 1e-9, "the kept bottom is the lower one");
assert(replaced[1].price < 18.35, "the replaced bottom is below the first trough");

console.log(
  "intradayExtreme.check ok",
  marks.map((mark) => `${mark.side}@${mark.price}`),
);
