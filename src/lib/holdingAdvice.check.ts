import {
  adviseHolding,
  closeHigherThanPrev,
  closeLowerThanPrev,
  closeStandsOnMa4,
  consecutiveMa4Days,
  holdingCheckRows,
  sectorHasOpenRedBox,
} from "./holdingAdvice.ts";
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

const allOn = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  standDays: 2,
  conceptInRedBox: true,
  stockAbovePrev: true,
});
assert(allOn.action === "hold" && allOn.label === "继续持有", "three red lights keep holding");
assert(allOn.stockOnMa4 && allOn.sectorInRedBox && allOn.conceptInRedBox && allOn.stockAbovePrev, "hold keeps the three flags");
assert(allOn.notes.includes("股价日K高于MA4"), "hold names the MA4 light");
assert(allOn.notes.includes("板块概念红框"), "hold names the dual red-box light");
assert(allOn.notes.includes("股价高于昨日"), "hold names the higher-close light");

const oneGray = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  conceptInRedBox: true,
  stockAbovePrev: true,
});
assert(oneGray.action === "hold" && oneGray.label === "继续持有", "one gray light still holds");
assert(oneGray.notes.includes("未满足股价日K高于MA4"), "the gray MA4 light is named");

const twoGray = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: true,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
  conceptInRedBox: true,
  stockAbovePrev: true,
});
assert(twoGray.action === "exit" && twoGray.label === "离场清仓", "two gray lights mean exit");
assert(twoGray.notes.includes("未满足股价日K高于MA4"), "exit names the gray MA4");
assert(twoGray.notes.includes("未满足板块概念红框"), "a missing industry box grays the dual-box light");

const threeGray = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
  conceptInRedBox: false,
  stockAbovePrev: false,
});
assert(threeGray.action === "exit" && threeGray.label === "离场清仓", "three gray lights mean exit");

const conceptOnly = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: true,
  conceptInRedBox: true,
  stockAbovePrev: true,
});
assert(conceptOnly.action === "hold", "industry box off but the other two red is still a hold");
assert(conceptOnly.notes.includes("未满足板块概念红框"), "industry without concept or concept without industry is one gray");

const industryOnly = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  conceptInRedBox: false,
  stockAbovePrev: true,
});
assert(industryOnly.action === "hold", "concept box off but the other two red is still a hold");

const belowPrev = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  conceptInRedBox: true,
  stockAbovePrev: false,
  stockCloseDown: true,
});
assert(belowPrev.action === "hold", "only the higher-close light gray is still a hold");
assert(belowPrev.notes.includes("未满足股价高于昨日"), "a close not above yesterday is named");

const ma4AndPrevGray = adviseHolding({
  stockOnMa4: false,
  sectorOnMa4: true,
  sectorInRedBox: true,
  hasSector: true,
  sectorResolved: true,
  conceptInRedBox: true,
  stockAbovePrev: false,
});
assert(ma4AndPrevGray.action === "exit" && ma4AndPrevGray.label === "离场清仓", "off MA4 and not above yesterday is an exit");

const missing = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: false,
  sectorResolved: false,
  conceptInRedBox: true,
  stockAbovePrev: true,
});
assert(missing.action === "hold", "a missing sector is one gray dual-box light, not an exit");
assert(missing.notes.some((note) => note.includes("缺少所属板块")), "missing sector is explained");

const unresolved = adviseHolding({
  stockOnMa4: true,
  sectorOnMa4: false,
  sectorInRedBox: false,
  hasSector: true,
  sectorResolved: false,
  conceptInRedBox: true,
  stockAbovePrev: true,
});
assert(unresolved.action === "hold", "an unresolved sector is one gray dual-box light, not an exit");
assert(unresolved.notes.some((note) => note.includes("暂无法核对")), "a failed sector fetch is explained");

assert(!closeLowerThanPrev(bars([10])), "one bar cannot be lower than yesterday");
assert(!closeLowerThanPrev(bars([10, 10])), "a flat close is not lower");
assert(!closeLowerThanPrev(bars([10, 11])), "a higher close is not lower");
assert(closeLowerThanPrev(bars([11, 10])), "a lower close is lower than yesterday");
assert(!closeHigherThanPrev(bars([10])), "one bar cannot be higher than yesterday");
assert(!closeHigherThanPrev(bars([10, 10])), "a flat close is not higher");
assert(closeHigherThanPrev(bars([10, 11])), "a higher close is above yesterday");
assert(!closeHigherThanPrev(bars([11, 10])), "a lower close is not above yesterday");

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

const lights = holdingCheckRows({
  stockOnMa4: true,
  sectorInRedBox: true,
  conceptInRedBox: false,
  stockAbovePrev: true,
});
assert(
  lights.map((row) => `${row.label}:${Number(row.on)}`).join("|") ===
    "股价日K高于MA4:1|板块概念红框:0|股价高于昨日:1",
  "holding lights are the three positive checks; dual-box needs both boards",
);
assert(
  holdingCheckRows({
    stockOnMa4: true,
    sectorInRedBox: true,
    conceptInRedBox: true,
    stockAbovePrev: false,
  })
    .map((row) => `${row.label}:${Number(row.on)}`)
    .join("|") === "股价日K高于MA4:1|板块概念红框:1|股价高于昨日:0",
  "a close not above yesterday turns that light gray",
);

console.log("holdingAdvice.check ok");
