import { adviseHolding, closeStandsOnMa4, consecutiveMa4Days, sectorHasOpenRedBox } from "./holdingAdvice.ts";
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
assert(keep.action === "hold" && keep.label === "继续持仓", "stock on MA4 and sector in the red box is a hold");
assert(keep.notes.includes("板块仍在红色趋势区间"), "hold notes keep the live red box");
assert(keep.notes.some((note) => note.includes("2日")), "hold notes keep the MA4 stand days");

const stockBreak = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(stockBreak.action === "exit" && stockBreak.label === "需要离场", "stock off MA4 means exit even if the box is live");
assert(stockBreak.notes.includes("股价收盘跌破MA4"), "stock break is named");
assert(!stockBreak.notes.includes("板块已离开红色趋势区间"), "a live box is not an extra exit reason");

const indexBreak = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(indexBreak.action === "hold", "sector off MA4 alone is not an exit while the red box is live");
assert(indexBreak.notes.includes("板块仍在红色趋势区间"), "a live red box is named on hold");
assert(indexBreak.notes.some((note) => note.includes("个股站上MA4")), "stock still on MA4 is named");

const bothBreak = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(bothBreak.action === "exit" && bothBreak.label === "需要离场", "stock off MA4 still exits when the box is live");
assert(bothBreak.notes.includes("股价收盘跌破MA4"), "exit names the stock break");
assert(!bothBreak.notes.includes("板块指数跌破MA4"), "index MA4 is not an exit reason");

const boxEnd = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
});
assert(boxEnd.action === "exit" && boxEnd.label === "需要离场", "leaving the red box forces an exit");
assert(boxEnd.notes.includes("板块已离开红色趋势区间"), "exit names the red-box leave");
assert(!boxEnd.notes.includes("股价收盘跌破MA4"), "stock still on MA4 is not an extra exit reason");

const bothExit = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: true,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
});
assert(bothExit.action === "exit", "either broken condition is enough, both still exit");
assert(bothExit.notes.includes("股价收盘跌破MA4"), "stock break is named");
assert(bothExit.notes.includes("板块已离开红色趋势区间"), "red-box leave is named");

const missing = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: false,
  sectorResolved: false,
});
assert(missing.action === "hold", "a missing sector is not treated as leaving the red box");
assert(missing.notes.some((note) => note.includes("缺少所属板块")), "missing sector is explained");

const missingStockBreak = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: false,
  sectorResolved: false,
});
assert(missingStockBreak.action === "exit", "stock off MA4 still exits when the sector is missing");
assert(missingStockBreak.notes.includes("股价收盘跌破MA4"), "stock break is named without a sector");

const unresolved = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: false,
});
assert(unresolved.action === "hold", "an unresolved sector is not treated as leaving the red box");
assert(unresolved.notes.some((note) => note.includes("暂无法核对")), "a failed sector fetch is explained");

const unresolvedStockBreak = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: false,
});
assert(unresolvedStockBreak.action === "exit", "stock off MA4 still exits when the sector fetch failed");

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
