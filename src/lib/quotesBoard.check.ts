import { isForeignTencentCode, toTencentCode } from "./codes.ts";
import {
  QUOTES_INSTRUMENTS,
  dayWeekStandOnMa4,
  quotesInstrument,
  sortQuotesByMa4Stand,
  standsOnMa4,
} from "./quotesBoard.ts";
import { parseSinaFuturesKline } from "./sources/sinaKlineParse.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const names = QUOTES_INSTRUMENTS.map((item) => item.name);
const codes = QUOTES_INSTRUMENTS.map((item) => item.code);

assert(names.includes("纳斯达克指数"), "nasdaq is on the quotes board");
assert(names.includes("标普指数"), "s&p is on the quotes board");
assert(names.includes("沪深300"), "csi 300 is on the quotes board");
assert(names.includes("科创50"), "star 50 is on the quotes board");
assert(names.includes("创业板指"), "chinext is on the quotes board");
assert(names.includes("黄金"), "gold is on the quotes board");
assert(names.includes("红利指数"), "dividend index is on the quotes board");
assert(names.includes("银行指数"), "bank index is on the quotes board");
assert(names.includes("石油"), "crude is on the quotes board");
assert(names.includes("日经225"), "nikkei is on the quotes board");
assert(names.filter((name) => name === "银行指数").length === 1, "bank index is listed once");
assert(new Set(codes).size === codes.length, "each quotes instrument has a unique code");

assert(quotesInstrument("usIXIC")?.name === "纳斯达克指数", "nasdaq lookup is case-preserving");
assert(quotesInstrument("USINX")?.code === "usINX", "s&p lookup is case-insensitive");
assert(quotesInstrument("gc")?.source === "sina", "gold is routed to sina");
assert(quotesInstrument("CL")?.sinaSymbol === "CL", "crude uses the sina CL contract");
assert(quotesInstrument("nk")?.sinaSymbol === "NK", "nikkei uses the sina NK contract");
assert(quotesInstrument("sz000001") == null, "plain a-shares are not quotes-board instruments");

assert(toTencentCode("usIXIC") === "usIXIC", "tencent keeps nasdaq mixed case");
assert(toTencentCode("usixic") === "usIXIC", "lowercase nasdaq still maps to usIXIC");
assert(toTencentCode("usINX") === "usINX", "tencent keeps s&p as usINX not usSPX");
assert(toTencentCode("sh000300") === "sh000300", "csi 300 still uses the shanghai prefix");
assert(toTencentCode("sz399006") === "sz399006", "chinext still uses the shenzhen prefix");
assert(toTencentCode("hf_GC") === "hf_GC", "tencent futures codes pass through");
assert(isForeignTencentCode("usIXIC"), "nasdaq is a foreign tencent code");
assert(isForeignTencentCode("usINX"), "s&p is a foreign tencent code");
assert(!isForeignTencentCode("sh000300"), "csi 300 is not foreign");
assert(!isForeignTencentCode("GC"), "sina gold is not a tencent foreign code");

const fromObjects = parseSinaFuturesKline([
  { date: "2026-10-01 00:00:00", open: "10", high: "12", low: "9", close: "11", volume: "100" },
  { date: "2026-10-02", open: 11, high: 13, low: 10.5, close: 12.5, volume: 80 },
]);
assert(fromObjects.length === 2, "object rows parse");
assert(fromObjects[0].time === "2026-10-01", "object date is trimmed to yyyy-mm-dd");
assert(fromObjects[1].close === 12.5, "object close is numeric");

const fromArrays = parseSinaFuturesKline([
  ["2026-10-08", "20", "22", "19", "21", "50"],
  ["2026-10-09", 21, 23, 20, 22],
]);
assert(fromArrays.length === 2, "array rows parse");
assert(fromArrays[0].open === 20 && fromArrays[1].volume === 0, "array volume defaults to 0");

assert(parseSinaFuturesKline(null).length === 0, "non-arrays yield no bars");
assert(parseSinaFuturesKline([{ date: "bad" }]).length === 0, "incomplete rows are skipped");

function bars(closes: number[]): KBar[] {
  return closes.map((close, i) => ({
    time: `2026-10-${String(i + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

assert(!standsOnMa4(bars([10, 11, 12])), "fewer than 4 bars cannot stand on MA4");
assert(standsOnMa4(bars([10, 11, 12, 13])), "a rising 4th close stands on MA4");
assert(!standsOnMa4(bars([10, 11, 12, 8])), "a close below MA4 is not standing");
assert(standsOnMa4(bars([10, 10, 10, 10])), "close equal to MA4 still counts as standing");
assert(
  dayWeekStandOnMa4(bars([10, 11, 12, 13]), bars([20, 21, 22, 23])),
  "day and week both on MA4 is a hit",
);
assert(
  !dayWeekStandOnMa4(bars([10, 11, 12, 13]), bars([20, 21, 22, 10])),
  "week off MA4 is not a hit",
);
assert(!dayWeekStandOnMa4(bars([10, 11, 12, 13]), null), "missing week bars is not a hit");

const ranked = sortQuotesByMa4Stand(
  [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }],
  (item) => item.code === "c" || item.code === "a",
);
assert(
  ranked.map((item) => item.code).join("") === "acbd",
  "standing codes a and c keep relative order and move in front of b and d",
);

console.log("quotes board checks passed");
