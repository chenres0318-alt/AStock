import { isExhaustionBar, shouldExitBuy } from "./sell-setup.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function bar(i: number, o: number, h: number, l: number, c: number, v: number): KBar {
  return {
    time: new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
  };
}

const grind: KBar[] = [];
let px = 10;
for (let i = 0; i < 40; i += 1) {
  px += 0.05;
  grind.push(bar(i, px - 0.02, px + 0.03, px - 0.04, px, 1000));
}
const limit = bar(40, px * 1.01, px * 1.1, px * 1.005, px * 1.1, 2500);
const wick = bar(41, px * 1.11, px * 1.22, px * 1.08, px * 1.09, 8000);
const breakMa = bar(42, px * 1.08, px * 1.09, px * 1.0, px * 1.01, 3000);
const rows = [...grind, limit, wick, breakMa];

assert(isExhaustionBar(rows, 41, 10), "post-limit long upper shadow with climax volume should count as exhaustion");
assert(!isExhaustionBar(rows, 40, 10), "the limit-up bar itself is not the sell");
const early = shouldExitBuy(rows.slice(0, 41), 40, 40, 10);
assert(!early.exit, "cannot sell on the buy bar");
const sold = shouldExitBuy(rows, 42, 40, 10);
assert(sold.exit, "after exhaustion, close under MA5 should exit");
assert(sold.reason.includes("放量长上影"), sold.reason);

console.log("sell-setup.check ok", sold.reason);
