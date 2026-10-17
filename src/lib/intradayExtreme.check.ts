import { intradayExtremes, type IntradayMinute } from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function minutes(prices: number[], avgs: number[]): IntradayMinute[] {
  return prices.map((price, index) => ({
    time: `${String(9 + Math.floor(index / 60)).padStart(2, "0")}:${String(30 + (index % 60)).padStart(2, "0")}`.replace(
      /:(\d\d)$/,
      (_, m: string) => `:${String(Number(m) % 60).padStart(2, "0")}`,
    ),
    price,
    avg: avgs[index] ?? 10,
  }));
}

const flat = minutes(Array.from({ length: 40 }, () => 10), Array.from({ length: 40 }, () => 10));
assert(intradayExtremes(flat, 10).length === 0, "a flat session has no top or bottom");

const dipPrices = [
  ...Array(12).fill(10),
  9.96, 9.92, 9.88, 9.84, 9.8, 9.84, 9.9, 9.96, 10, 10.02,
  ...Array(12).fill(10.02),
];
const dip = minutes(dipPrices, dipPrices.map(() => 10));
const bottoms = intradayExtremes(dip, 10);
assert(bottoms.length === 1 && bottoms[0].side === "bottom" && bottoms[0].price === 9.8, "a stretch under the average that turns up is a bottom");

const popPrices = [
  ...Array(12).fill(10),
  10.04, 10.08, 10.12, 10.16, 10.2, 10.16, 10.1, 10.04, 10, 9.98,
  ...Array(12).fill(9.98),
];
const pop = minutes(popPrices, popPrices.map(() => 10));
const tops = intradayExtremes(pop, 10);
assert(tops.length === 1 && tops[0].side === "top" && tops[0].price === 10.2, "a stretch over the average that turns down is a top");

const wigglePrices = [...Array(12).fill(10), 10.02, 10.03, 10.02, ...Array(12).fill(10)];
const wiggle = minutes(wigglePrices, wigglePrices.map(() => 10));
assert(intradayExtremes(wiggle, 10).length === 0, "a small bend around the average is not a signal");

console.log("intradayExtreme.check ok", { bottom: bottoms[0].time, top: tops[0].time });
