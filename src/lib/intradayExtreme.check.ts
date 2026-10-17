import { intradayExtremes, type IntradayMinute } from "./intradayExtreme.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function minutes(prices: number[], volumes: number[]): IntradayMinute[] {
  return prices.map((price, index) => ({
    time: `${String(9 + Math.floor((30 + index) / 60)).padStart(2, "0")}:${String((30 + index) % 60).padStart(2, "0")}`,
    price,
    volume: volumes[index] ?? 1000,
  }));
}

const flat = minutes(Array.from({ length: 40 }, () => 10), Array.from({ length: 40 }, () => 1000));
assert(intradayExtremes(flat).length === 0, "a flat session has no top or bottom");

const topPrices = [
  ...Array(20).fill(10),
  10, 10.04, 10.1, 10.2, 10.26, 10.3, 10.32, 10.24,
  ...Array(8).fill(10.2),
];
const topVolumes = [...Array(24).fill(1000), 700, 700, 700, ...Array(9).fill(800)];
const tops = intradayExtremes(minutes(topPrices, topVolumes));
assert(tops.length === 1 && tops[0].side === "top" && tops[0].price === 10.32, "a slowing rally with fading volume is a top");

const bottomPrices = [
  ...Array(20).fill(10),
  10, 9.96, 9.9, 9.8, 9.74, 9.7, 9.68, 9.76,
  ...Array(8).fill(9.8),
];
const bottomVolumes = [...Array(24).fill(1000), 600, 600, 600, ...Array(9).fill(700)];
const bottoms = intradayExtremes(minutes(bottomPrices, bottomVolumes));
assert(
  bottoms.length === 1 && bottoms[0].side === "bottom" && bottoms[0].price === 9.68,
  "a slowing drop with shrinking volume is a bottom",
);

const spikePrices = [
  ...Array(20).fill(10),
  10.05, 10.15, 10.25, 10.35, 10.36, 10.22, 10.42, 10.3,
  ...Array(8).fill(10.28),
];
const spikeVolumes = [...Array(24).fill(1000), 50, 50, 2000, ...Array(9).fill(800)];
assert(intradayExtremes(minutes(spikePrices, spikeVolumes)).length === 0, "a sharp volume spike is not a top");

const wigglePrices = [...Array(20).fill(10), 10.01, 10.02, 10.015, ...Array(8).fill(10.01)];
assert(intradayExtremes(minutes(wigglePrices, Array(wigglePrices.length).fill(1000))).length === 0, "a small bend is not a signal");

console.log("intradayExtreme.check ok", { top: tops[0].time, bottom: bottoms[0].time });
