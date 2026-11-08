import { cached } from "./cache.ts";
import { parseTonghuashunBlockrank } from "./thsBlockrank.ts";
import { fallbackConceptBoards, THS_CONCEPT_CATALOG } from "./thsConceptCatalog.ts";
import { SCREENER_BOARD_MEMBER_LIMIT, tonghuashunMemberPageCount } from "./thsMemberPages.ts";
import { fallbackIndustryBoards, THS_INDUSTRY_CATALOG } from "./thsIndustryCatalog.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const seeded = fallbackIndustryBoards();
assert(THS_INDUSTRY_CATALOG.length >= 80, "the built-in industry roster covers the Tonghuashun set");
assert(seeded.some((item) => item.code === "881121" && item.name === "半导体"), "the fallback still has 半导体");
assert(new Set(seeded.map((item) => item.code)).size === seeded.length, "fallback industry codes are unique");

await cached("stale-industry-test", 1, async () => "live");
await new Promise((resolve) => setTimeout(resolve, 5));
const stale = await cached("stale-industry-test", 1, async () => {
  throw new Error("refresh failed");
});
assert(stale === "live", "an expired industry list is reused when Tonghuashun fails");

let loads = 0;
await cached("empty-live-scan", 60_000, async () => {
  loads += 1;
  return { codes: [] as string[] };
}, (value) => value.codes.length > 0);
await cached("empty-live-scan", 60_000, async () => {
  loads += 1;
  return { codes: [] as string[] };
}, (value) => value.codes.length > 0);
assert(loads === 2, "an empty live-board scan is not cached");

assert(SCREENER_BOARD_MEMBER_LIMIT >= 200, "screener member lists cover more than the old top 40");
assert(tonghuashunMemberPageCount(40) === 4, "the sector page still uses four member pages");
assert(
  tonghuashunMemberPageCount(SCREENER_BOARD_MEMBER_LIMIT) >= 20,
  "screener member lists fetch at least 20 pages",
);

const concepts = fallbackConceptBoards();
assert(THS_CONCEPT_CATALOG.length >= 200, "the built-in concept roster covers the Tonghuashun set");
assert(concepts.some((item) => item.code === "885525" && item.name === "白酒概念"), "the fallback still has 白酒概念");
assert(new Set(concepts.map((item) => item.code)).size === concepts.length, "fallback concept codes are unique");

const ranked = parseTonghuashunBlockrank(
  `quotebridge_v6_blockrank_881121_199112_d10({"block":{"name":"半导体","subcodeCount":190},"items":{"0":{"5":"600001","10":"10.5","19":"100","55":"测试股","199112":"1.2","1968584":"2.3"}}})`,
);
assert(ranked.total === 190 && ranked.members[0]?.code === "600001" && ranked.members[0]?.name === "测试股", "blockrank JSONP still names constituents");
assert(ranked.members[0]?.price === 10.5 && ranked.members[0]?.pct === 1.2, "blockrank JSONP keeps price and percent");

console.log("cache.check ok", seeded.length, concepts.length);
