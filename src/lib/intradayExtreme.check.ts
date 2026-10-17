import { intradayExtremes, lotSpreadCoversCost, type IntradayMinute } from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function minutes(prices: number[]): IntradayMinute[] {
  return prices.map((price, index) => ({
    time: `t${index}`,
    price,
    volume: 1000,
  }));
}

function flat(count: number, price: number) {
  return Array.from({ length: count }, () => price);
}

function ramp(from: number, count: number, step: number) {
  const prices: number[] = [];
  let price = from;
  for (let i = 0; i < count; i += 1) {
    price += step;
    prices.push(price);
  }
  return { prices, end: price };
}

assert(lotSpreadCoversCost(10, 10.04) === false, "four cents does not cover a 5 yuan commission plus stamp tax");
assert(lotSpreadCoversCost(10, 10.06) === true, "six cents on one lot covers the commission and stamp tax");
assert(intradayExtremes(minutes(flat(80, 10))).length === 0, "a flat session has no top or bottom");

const swing = flat(40, 10);
let leg = ramp(10, 8, -0.25);
swing.push(...leg.prices);
swing.push(leg.end, leg.end + 0.05, leg.end + 0.08);
leg = ramp(leg.end + 0.08, 30, 0.02);
swing.push(...leg.prices);
leg = ramp(leg.end, 12, 0.12);
swing.push(...leg.prices);
swing.push(leg.end - 0.04, leg.end - 0.1, leg.end - 0.12);
const marks = intradayExtremes(minutes(swing));
assert(marks.length === 2 && marks[0].side === "bottom" && marks[1].side === "top", "a bottom comes before the top");
assert(Math.abs(marks[0].price - 8) < 1e-9 && Math.abs(marks[1].price - 10.12) < 1e-9, "the bottom is the day low and the top is the later high");
assert(lotSpreadCoversCost(marks[0].price, marks[1].price), "the pair clears the one-lot cost");

const earlyTop = flat(40, 10);
leg = ramp(10, 40, 0.05);
earlyTop.push(...leg.prices);
earlyTop.push(leg.end - 0.02, leg.end - 0.05);
assert(
  intradayExtremes(minutes(earlyTop)).every((mark) => mark.side !== "top"),
  "a top is not marked before any bottom",
);

console.log("intradayExtreme.check ok", marks.map((mark) => `${mark.side}@${mark.price}`));
