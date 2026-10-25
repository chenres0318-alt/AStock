import { forcedBoardForStock, mergeBoardMembers } from "./boardExtras.ts";
import type { BoardMember } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function member(code: string, name: string, amount: number | null = 1): BoardMember {
  return { code, name, price: 10, pct: 1, amount, turnover: 1 };
}

const merged = mergeBoardMembers("881121", [member("002185", "华天科技")]);
assert(merged[0].code === "600206" && merged[0].name === "有研新材", "有研新材 is prepended to 半导体");
assert(merged.some((row) => row.code === "002185"), "upstream members are kept");
assert(merged.filter((row) => row.code === "600206").length === 1, "the extra name is listed once");

const already = mergeBoardMembers("881121", [member("600206", "有研新材", 9), member("002185", "华天科技")]);
assert(already[0].code === "600206", "an upstream 有研新材 keeps its fetched row");
assert(already.length === 2, "a name already on the board is not duplicated");

assert(mergeBoardMembers("881273", [member("600519", "贵州茅台")]).every((row) => row.code !== "600206"), "白酒 does not get the 半导体 extra");

assert(forcedBoardForStock("600206")?.sectorCode === "881121", "bare 有研新材 maps to 半导体");
assert(forcedBoardForStock("sh600206")?.sector === "半导体", "prefixed 有研新材 still maps to 半导体");
assert(forcedBoardForStock("sh600519") == null, "茅台 is not forced onto 半导体");

console.log("boardExtras checks passed");
