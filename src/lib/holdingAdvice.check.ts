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
assert(keep.action === "hold" && keep.label === "继续持仓", "all three screener conditions still hold");
assert(keep.notes.includes("板块红框"), "hold notes keep the red-box condition");
assert(keep.notes.some((note) => note.includes("2日")), "hold notes keep the MA4 stand days");

const stockBreak = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(stockBreak.action === "exit" && stockBreak.label === "需要离场", "stock off MA4 means exit");
assert(stockBreak.notes.includes("股价收盘跌破MA4"), "stock break is named");
assert(!stockBreak.notes.includes("板块已离开红色趋势区间"), "still-true sector conditions are not listed as exit reasons");

const indexBreak = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
});
assert(indexBreak.notes.includes("板块指数跌破MA4"), "index break is named");

const boxEnd = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
});
assert(boxEnd.notes.includes("板块已离开红色趋势区间"), "a closed box means exit");

const missing = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: false,
  sectorResolved: false,
});
assert(missing.action === "exit", "no sector cannot be confirmed as a hold");
assert(missing.notes[0].includes("缺少所属板块"), "missing sector is explained");

const unresolved = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: false,
});
assert(unresolved.notes[0].includes("暂无法核对"), "a failed sector fetch is explained");

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
