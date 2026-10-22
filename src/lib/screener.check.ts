import { matchIndustryBoard } from "./screenerLogic.ts";
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

console.log("screener.check ok");
