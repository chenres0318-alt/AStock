import { applyBoardLive, mergeLiveCodes } from "./boardLive.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(
  applyBoardLive(["881121"], "881156", false).join(",") === "881121",
  "switching to a board that is not live must keep 半导体 red",
);
assert(
  applyBoardLive([], "881121", true).join(",") === "881121",
  "the current open board is added even before the full list arrives",
);
assert(
  applyBoardLive(["881121", "881174"], "881121", false).join(",") === "881174",
  "a board whose own report is no longer open is dropped by itself",
);
assert(
  mergeLiveCodes(["881121"], ["881174", "881121"]).sort().join(",") === "881121,881174",
  "the full live list merges onto names already discovered from the current board",
);

console.log("boardLive.check ok");
