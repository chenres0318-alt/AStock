import { isTonghuashunBoard, isTonghuashunConcept, isTonghuashunIndustry } from "./codes.ts";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  listMa4CrossStocks,
  maStandFlags,
  standsOnMa4,
  trendCoversLastBar,
  type SectorMemberPath,
} from "./sectorTrend.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function tradingBars(closes: number[], start = "2024-01-02"): KBar[] {
  const origin = Date.parse(`${start}T00:00:00Z`);
  const bars: KBar[] = [];
  let offset = 0;
  for (let i = 0; i < closes.length; i += 1) {
    let time = "";
    while (true) {
      const date = new Date(origin + offset * 86_400_000);
      offset += 1;
      const dow = date.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      time = date.toISOString().slice(0, 10);
      break;
    }
    const close = closes[i];
    const prev = i > 0 ? closes[i - 1] : close;
    const rising = close >= prev;
    const open = Number((rising ? prev * 0.998 : prev * 1.004).toFixed(4));
    bars.push({
      time,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 1000,
    });
  }
  return bars;
}

/** 约 24 个月交易日，前段抬升让月K能够站上 MA20。 */
function risingCloses(days = 520): number[] {
  return Array.from({ length: days }, (_, i) => Number((1000 + i * 1.2).toFixed(4)));
}

function membersFollowing(bars: KBar[]): SectorMemberPath[] {
  return Array.from({ length: 8 }, (_, index) => {
    const closes = new Map<string, number>();
    bars.forEach((bar, i) => {
      closes.set(bar.time, index === 0 ? bar.close * (1 + 0.01 * i) : bar.close);
    });
    return { code: `sh60000${index}`, name: index === 0 ? "龙头" : `跟风${index}`, closes };
  });
}

const rising = tradingBars(risingCloses());
const risingFlags = maStandFlags(rising);
const firstStart = risingFlags.findIndex(
  (row) => row.dayOnMa4 && row.dayOnMa7 && row.weekOnMa4 && row.weekOnMa7 && row.monthOnMa20,
);
assert(firstStart >= 0, "a long rise eventually stands on daily MA4/MA7, weekly MA4/MA7 and monthly MA20");
const risingTrends = captureSectorTrends(rising, membersFollowing(rising));
assert(risingTrends.length === 1 && risingTrends[0].status === "open", "the MA alignment opens one red box");
assert(risingTrends[0].start === rising[firstStart].time, "the box starts on the first day all MAs stand");
assert(risingTrends[0].end === rising.at(-1)?.time, "the open box runs through the latest bar");
assert(risingTrends[0].leaders[0]?.name === "龙头", "member breadth still names the leader inside the box");
assert(indexCouldBeOpen(rising), "the rise still looks open on the index alone");
assert(trendCoversLastBar(risingTrends, rising.at(-1)?.time), "an open box covers the latest bar");

const noMembers = captureSectorTrends(rising, []);
assert(noMembers.length === 1 && noMembers[0].status === "open", "the box does not need constituents");
assert(noMembers[0].memberCount === 0, "no constituents means empty breadth");

const falling = tradingBars(Array.from({ length: 520 }, (_, i) => Number((2000 - i * 1.2).toFixed(4))));
assert(captureSectorTrends(falling).length === 0, "a long decline never starts a red box");
assert(!indexCouldBeOpen(falling), "a decline is not an open trend");

const crashedCloses = risingCloses();
const last = crashedCloses[crashedCloses.length - 1]!;
for (let i = 0; i < 8; i += 1) crashedCloses.push(Number((last * 0.7).toFixed(4)));
const crashed = tradingBars(crashedCloses);
const crashedTrends = captureSectorTrends(crashed);
assert(crashedTrends.length === 1 && crashedTrends[0].status === "closed", "breaking both daily MA4 and MA7 closes the box");
assert(crashedTrends[0].end !== crashed.at(-1)?.time, "the gray box stops before the break day");
const oneAndDone = rising.slice(0, firstStart + 1);
const started = oneAndDone.at(-1)!;
oneAndDone.push({ ...started, time: "2099-01-06", open: 1, high: 1, low: 1, close: 1 });
assert(captureSectorTrends(oneAndDone).length === 0, "a start that both-breaks the next day leaves no gray stub");
assert(!indexCouldBeOpen(crashed), "both daily averages broken is no longer an open trend");
assert(!trendCoversLastBar(crashedTrends, crashed.at(-1)?.time), "a closed box does not cover the latest bar");

const dipCloses = risingCloses();
const dipLast7 = dipCloses.slice(-7);
const belowMa4 = (dipLast7[4]! + dipLast7[5]! + dipLast7[6]!) / 3;
const aboveMa7 = (dipLast7[1]! + dipLast7[2]! + dipLast7[3]! + dipLast7[4]! + dipLast7[5]! + dipLast7[6]!) / 6;
dipCloses.push(Number(((belowMa4 + aboveMa7) / 2).toFixed(4)));
const dipped = tradingBars(dipCloses);
const dipFlags = maStandFlags(dipped).at(-1);
assert(dipFlags && !dipFlags.dayOnMa4 && dipFlags.dayOnMa7, "a dip through MA4 can still stand on MA7");
const stillOpen = captureSectorTrends(dipped);
assert(stillOpen.length === 1 && stillOpen[0].status === "open", "leaving only one of MA4/MA7 does not end the red box");

const short = tradingBars(Array.from({ length: 30 }, (_, i) => 100 + i));
assert(captureSectorTrends(short).length === 0, "fewer than 20 monthly bars cannot start");
assert(!indexCouldBeOpen(short), "a short tape cannot be an open red box");

assert(isTonghuashunIndustry("881121") && !isTonghuashunConcept("881121"), "an industry code stays an industry");
assert(isTonghuashunConcept("885457") && isTonghuashunConcept("886056"), "concept indexes use 885 and 886");
assert(isTonghuashunBoard("881121") && isTonghuashunBoard("885457"), "both industry and concept boards can open the trend page");
assert(!isTonghuashunBoard("601138"), "a stock code is not a Tonghuashun board");

function datedBars(closes: number[], start = "2026-01-02"): KBar[] {
  return tradingBars(closes, start);
}

const freshCloses = [10, 11, 12, 13, 14, 5, 20];
const heldCloses = Array.from({ length: 16 }, () => 12);
const fresh = datedBars(freshCloses);
const heldLong = datedBars(heldCloses);
const standWindow = { start: fresh[3].time, end: fresh[fresh.length - 1].time };

const ranked = listMa4CrossStocks(standWindow, [
  { code: "sh600001", name: "站久", bars: heldLong },
  { code: "sz000002", name: "刚站上", bars: fresh },
]);
assert(ranked.length === 2, "both names that stand on MA4 are kept, even without a 4/7 cross");
assert(ranked[0].name === "刚站上" && ranked[0].days < ranked[1].days, "the shorter MA4 stand sorts first");
assert(ranked[1].name === "站久", "the longer MA4 stand sorts after");
assert(standsOnMa4(fresh) && standsOnMa4(heldLong), "both tapes close above MA4");

assert(
  listMa4CrossStocks(standWindow, [{ code: "sh688001", name: "科创", bars: fresh }]).length === 0,
  "STAR board names are dropped",
);
assert(
  listMa4CrossStocks(standWindow, [{ code: "sz300001", name: "创业", bars: fresh }]).length === 0,
  "ChiNext 300 names are dropped",
);
assert(
  listMa4CrossStocks(standWindow, [{ code: "sz301001", name: "创业注册", bars: fresh }]).length === 0,
  "ChiNext 301 names are dropped",
);

assert(
  listMa4CrossStocks(standWindow, [{ code: "sz000003", name: "回落", bars: fresh, price: 1 }]).length === 0,
  "a live print under MA4 is not kept",
);

const stillUnder = datedBars(Array.from({ length: 12 }, () => 10));
assert(
  listMa4CrossStocks({ start: stillUnder[8].time, end: stillUnder[11].time }, [
    { code: "sh600002", name: "持平", bars: stillUnder },
  ]).length === 1,
  "a flat tape still stands on MA4 when close equals the average",
);

const fallingTape = datedBars(Array.from({ length: 16 }, (_, i) => Number((20 - i * 0.12).toFixed(4))));
assert(
  listMa4CrossStocks({ start: fallingTape[10].time, end: fallingTape[15].time }, [
    { code: "sh600003", name: "下跌", bars: fallingTape },
  ]).length === 0,
  "a decline that stays under MA4 is not kept",
);
assert(!standsOnMa4(fallingTape), "the falling tape is not standing on MA4");

console.log("sectorTrend.check ok", {
  start: risingTrends[0].start,
  closedEnd: crashedTrends[0].end,
});
