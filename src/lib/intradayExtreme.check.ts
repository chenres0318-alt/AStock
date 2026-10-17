import { intradayExtremes, type IntradayMinute } from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function minutes(prices: number[]): IntradayMinute[] {
  return prices.map((price, index) => ({
    time: String(index),
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

assert(intradayExtremes(minutes(flat(100, 10))).length === 0, "a flat session has no top or bottom");

const wiggle = flat(40, 10);
let wigglePrice = 10;
for (let i = 0; i < 50; i += 1) {
  wigglePrice += i % 2 === 0 ? 0.01 : -0.01;
  wiggle.push(wigglePrice);
}
assert(intradayExtremes(minutes(wiggle)).length === 0, "a small bend is not a signal");

const rally = flat(45, 10);
let rolled = ramp(10, 35, 0.05);
rally.push(...rolled.prices);
rolled = ramp(rolled.end, 30, -0.06);
rally.push(...rolled.prices);
const tops = intradayExtremes(minutes(rally)).filter((mark) => mark.side === "top");
assert(tops.length === 1, "a rally that rolls over has one top where DIF crosses under DEA");

const rebound = flat(45, 12);
let leg = ramp(12, 40, -0.05);
rebound.push(...leg.prices);
leg = ramp(leg.end, 35, 0.07);
rebound.push(...leg.prices);
const bottoms = intradayExtremes(minutes(rebound)).filter((mark) => mark.side === "bottom");
assert(bottoms.length === 1, "a decline that turns up has one bottom where DIF crosses above DEA");

const weak = flat(45, 12);
leg = ramp(12, 25, -0.02);
weak.push(...leg.prices);
leg = ramp(leg.end, 15, -0.12);
weak.push(...leg.prices);
leg = ramp(leg.end, 8, 0.02);
weak.push(...leg.prices);
leg = ramp(leg.end, 20, -0.06);
weak.push(...leg.prices);
const weakMarks = intradayExtremes(minutes(weak));
assert(
  weakMarks.every((mark) => mark.side !== "bottom"),
  "a weak red column below zero is not a bottom",
);
assert(
  weakMarks.some((mark) => mark.side === "top"),
  "the failed bounce still marks a top when the red column fades",
);

console.log("intradayExtreme.check ok", {
  top: tops[0]?.index,
  bottom: bottoms[0]?.index,
  weak: weakMarks.map((mark) => mark.side),
});
