import { adviseHolding, closeLowerThanPrev, closeStandsOnMa4, consecutiveMa4Days, sectorHasOpenRedBox } from "./holdingAdvice.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function bars(closes: number[]): KBar[] {
  return closes.map((close, index) => ({
    time: `2026-01-${String(index + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

const keep = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  standDays: 2,
});
assert(keep.action === "hold" && keep.label === "继续持仓", "stock and sector both on MA4 is a hold");
assert(!keep.notes.includes("板块红框"), "red-box trend is not part of the hold check");
assert(!keep.notes.includes("板块仍在红色趋势区间"), "red-box status is not a hold note");
assert(keep.notes.includes("板块指数站上MA4"), "hold notes keep the sector MA4");
assert(keep.notes.some((note) => note.includes("2日")), "hold notes keep the MA4 stand days");

const stockBreak = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(stockBreak.action === "hold", "stock off MA4 alone is not an exit");
assert(stockBreak.notes.includes("股价收盘跌破MA4"), "stock break is still named");
assert(stockBreak.notes.includes("板块指数站上MA4"), "sector still on MA4 is named");

const indexBreak = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(indexBreak.action === "hold", "sector off MA4 alone is not an exit");
assert(indexBreak.notes.includes("板块指数跌破MA4"), "index break is named");
assert(indexBreak.notes.some((note) => note.includes("个股站上MA4")), "stock still on MA4 is named");

const bothBreak = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  stockCloseDown: true,
  sectorCloseDown: true,
});
assert(bothBreak.action === "exit" && bothBreak.label === "需要离场", "both off MA4 with lower closes means exit");
assert(bothBreak.notes.includes("股价收盘跌破MA4且低于昨日"), "exit names the stock break and lower close");
assert(bothBreak.notes.includes("板块指数跌破MA4且低于昨日"), "exit names the index break and lower close");
assert(!bothBreak.notes.includes("板块已离开红色趋势区间"), "red-box trend is not an exit reason");

const bothBreakStockUp = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  stockCloseDown: false,
  sectorCloseDown: true,
});
assert(bothBreakStockUp.action === "hold", "both off MA4 but stock close not lower is a hold");
assert(bothBreakStockUp.notes.includes("股价收盘未低于昨日"), "a rebound stock close is named");

const bothBreakIndexUp = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  stockCloseDown: true,
  sectorCloseDown: false,
});
assert(bothBreakIndexUp.action === "hold", "both off MA4 but index close not lower is a hold");
assert(bothBreakIndexUp.notes.includes("板块指数收盘未低于昨日"), "a rebound index close is named");

const bothBreakNoDown = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(bothBreakNoDown.action === "hold", "both off MA4 without lower-close confirmation is a hold");

const boxEnd = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
});
assert(boxEnd.action === "hold", "leaving the red box does not force an exit");
assert(!boxEnd.notes.includes("板块已离开红色趋势区间"), "red-box status is ignored");

const boxEndStockOn = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
});
assert(boxEndStockOn.action === "hold", "a dead red box with stock still on MA4 is not an exit");

const missing = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: false,
  sectorResolved: false,
});
assert(missing.action === "hold", "a missing sector is not treated as both broken");
assert(missing.notes.some((note) => note.includes("缺少所属板块")), "missing sector is explained");

const unresolved = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: false,
});
assert(unresolved.action === "hold", "an unresolved sector is not treated as both broken");
assert(unresolved.notes.some((note) => note.includes("暂无法核对")), "a failed sector fetch is explained");

assert(!closeLowerThanPrev(bars([10])), "one bar cannot be lower than yesterday");
assert(!closeLowerThanPrev(bars([10, 10])), "a flat close is not lower");
assert(!closeLowerThanPrev(bars([10, 11])), "a higher close is not lower");
assert(closeLowerThanPrev(bars([11, 10])), "a lower close is lower than yesterday");

assert(!closeStandsOnMa4(bars([10, 11, 12])), "fewer than 4 bars cannot stand on MA4");
assert(closeStandsOnMa4(bars([8, 9, 10, 11, 12])), "a rising close stands on MA4");
assert(consecutiveMa4Days(bars([10, 11, 12])) === 0, "fewer than 4 bars is not a stand");
assert(consecutiveMa4Days(bars([10, 10, 10, 10])) === 1, "four flat bars count as one day on MA4 at the last print");
assert(consecutiveMa4Days(bars([8, 9, 10, 11, 12, 13])) >= 2, "a rising tape keeps more than one day on MA4");
assert(consecutiveMa4Days(bars([10, 11, 12, 13, 9])) === 0, "a close below MA4 resets the stand");

assert(
  sectorHasOpenRedBox({
    bars: bars([10, 11, 12, 13]),
    trends: [{ status: "open", end: "2026-01-04" }],
  }),
  "an open box covering the last bar is still live",
);
assert(
  !sectorHasOpenRedBox({
    bars: bars([10, 11, 12, 13]),
    trends: [{ status: "open", end: "2026-01-03" }],
  }),
  "an open box that stopped before the last bar is not live",
);
assert(
  !sectorHasOpenRedBox({
    bars: bars([10, 11, 12, 13]),
    trends: [{ status: "closed", end: "2026-01-04" }],
  }),
  "a grey closed box is not a hold",
);

console.log("holdingAdvice.check ok");
