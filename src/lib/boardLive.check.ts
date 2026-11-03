import { applyBoardLive, mergeLiveCodes, mergeTrendScan, parseActiveListScope } from "./boardLive.ts";

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

assert(
  applyBoardLive([], "885799", true).join(",") === "885799",
  "a live concept is marked without waiting to open it",
);

const merged = mergeTrendScan(
  { codes: ["881121"], offMa4: ["881121"] },
  { codes: ["885799"], offMa4: [] },
);
assert(merged.codes.sort().join(",") === "881121,885799", "industry and concept live lists combine");
assert(merged.offMa4.join(",") === "881121", "concept off-MA4 stays independent");
assert(parseActiveListScope(null) === "industry", "the default live list stays industries for screener");
assert(parseActiveListScope("concept") === "concept", "the sector page can ask for concepts");
assert(parseActiveListScope("all") === "all", "all combines industry and concept scans");
assert(parseActiveListScope("nope") === "industry", "unknown scopes do not change the screener universe");

console.log("boardLive.check ok");
