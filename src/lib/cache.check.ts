import { cached } from "./cache.ts";
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

console.log("cache.check ok", seeded.length);
