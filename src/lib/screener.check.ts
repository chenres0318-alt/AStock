import { collectMa4StandHits, matchIndustryBoard, type SectorMa4Screen } from "./screenerLogic.ts";
import type { SectorItem } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function board(code: string, name: string): SectorItem {
  return {
    code,
    name,
    pct: null,
    price: null,
    leader: null,
    leaderCode: null,
    upCount: null,
    downCount: null,
    source: "ths",
  };
}

const boards = [board("881121", "白酒"), board("881157", "半导体"), board("881171", "自动化设备")];

assert(matchIndustryBoard("白酒", boards)?.code === "881121", "an exact industry name maps to that Tonghuashun board");
assert(matchIndustryBoard("食品饮料-白酒", boards)?.name === "白酒", "a longer F10 name still finds the board");
assert(matchIndustryBoard("酿酒行业", [board("881199", "酿酒"), ...boards])?.name === "酿酒", "dropping the 行业 suffix still finds the board");
assert(matchIndustryBoard("半导体", boards)?.code === "881157", "another industry still matches");
assert(matchIndustryBoard("未知行业", boards) == null, "an unknown industry does not invent a board");
assert(matchIndustryBoard("  ", boards) == null, "blank industry text is ignored");

function screen(partial: Partial<SectorMa4Screen> & Pick<SectorMa4Screen, "code" | "name">): SectorMa4Screen {
  return {
    onMa4: true,
    lastTime: "2026-10-23",
    openTrend: { start: "2026-10-20", end: "2026-10-23", status: "open" },
    crosses: [],
    members: [],
    ...partial,
  };
}

const short = { code: "sh600001", name: "短站", days: 1, time: "2026-10-23" };
const long = { code: "sh600002", name: "长站", days: 4, time: "2026-10-20" };
const members = [
  { code: "sh600001", name: "短站", price: 10, pct: 1.2, turnover: 2 },
  { code: "sh600002", name: "长站", price: 20, pct: -0.5, turnover: 3 },
];

assert(collectMa4StandHits([screen({ onMa4: false, crosses: [short] })]).length === 0, "index off MA4 is skipped");
assert(
  collectMa4StandHits([screen({ openTrend: { start: "2026-10-01", end: "2026-10-10", status: "closed" }, crosses: [short] })]).length === 0,
  "a closed grey box is skipped",
);
assert(
  collectMa4StandHits([screen({ lastTime: "2026-10-24", crosses: [short] })]).length === 0,
  "a red box that does not cover the last bar is skipped",
);
assert(collectMa4StandHits([screen({ openTrend: null, crosses: [short] })]).length === 0, "no open box means no hits");

const ranked = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [long, short],
    members,
  }),
]);
assert(ranked.length === 2, "both names standing on MA4 are kept");
assert(ranked[0].name === "短站" && ranked[0].days === 1, "the shortest MA4 stand comes first");
assert(ranked[1].name === "长站", "the longer stand is still listed after");
assert(ranked[0].sectorCode === "881121", "the hit keeps the industry board");
assert(ranked[0].price === 10, "price comes from the board roster");

const dup = collectMa4StandHits([
  screen({ code: "881121", name: "半导体", crosses: [{ ...short, days: 3 }], members }),
  screen({ code: "881157", name: "白酒", crosses: [short], members }),
]);
assert(dup.length === 1, "the same name is not listed twice");
assert(dup[0].days === 1 && dup[0].sector === "白酒", "the shorter stand wins when a name sits in two boxes");

console.log("screener.check ok");
