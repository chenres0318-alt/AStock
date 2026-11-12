import { isTonghuashunBoard, isTonghuashunConcept, isTonghuashunIndustry } from "./codes.ts";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  listMa4CrossStocks,
  listMa4Ma7StandStocks,
  listMa4Ma7Ma10StandStocks,
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

/** 足够长的抬升，让月/周 MA4 向上且收盘大于 MA4。 */
function risingCloses(days = 520): number[] {
  return Array.from({ length: days }, (_, i) => Number((1000 + i * 1.2).toFixed(4)));
}

function isBoxStart(row: { dayOnMa4: boolean; weekOnMa4: boolean; weekMa4Up: boolean; monthOnMa4: boolean; monthMa4Up: boolean }): boolean {
  return row.dayOnMa4 && row.weekOnMa4 && row.weekMa4Up && row.monthOnMa4 && row.monthMa4Up;
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
const firstStart = risingFlags.findIndex(isBoxStart);
assert(firstStart >= 0, "a long rise eventually starts a red box");
assert(firstStart > 9, "monthly MA4 turning up takes more than ten daily bars");
assert(risingFlags[firstStart]?.weekOnMa4 && risingFlags[firstStart]?.weekMa4Up, "start requires weekly close above MA4 with MA4 turning up");
assert(risingFlags[firstStart]?.monthOnMa4 && risingFlags[firstStart]?.monthMa4Up, "start requires monthly close above MA4 with MA4 turning up");
assert(risingFlags[firstStart]?.dayOnMa4, "start requires daily close above MA4");
const risingTrends = captureSectorTrends(rising, membersFollowing(rising));
assert(risingTrends.length === 1 && risingTrends[0].status === "open", "the MA alignment opens one red box");
assert(risingTrends[0].start === rising[firstStart].time, "the box starts on the first day month, week and day all qualify");
assert(risingTrends[0].end === rising.at(-1)?.time, "the open box runs through the latest bar");
assert(risingTrends[0].leaders[0]?.name === "龙头", "member breadth still names the leader inside the box");
assert(indexCouldBeOpen(rising), "the rise still looks open on the index alone");
assert(indexCouldBeOpen(rising.slice(-160)), "a short recent window still sees an open box");
assert(trendCoversLastBar(risingTrends, rising.at(-1)?.time), "an open box covers the latest bar");

const noMembers = captureSectorTrends(rising, []);
assert(noMembers.length === 1 && noMembers[0].status === "open", "the box does not need constituents");
assert(noMembers[0].memberCount === 0, "no constituents means empty breadth");

const falling = tradingBars(Array.from({ length: 520 }, (_, i) => Number((2000 - i * 1.2).toFixed(4))));
assert(captureSectorTrends(falling).length === 0, "a long decline never starts a red box");
assert(!indexCouldBeOpen(falling), "a decline is not an open trend");
assert(!indexCouldBeOpen(falling.slice(-80)), "a short recent decline is still not an open box");

const crashedCloses = risingCloses();
const last = crashedCloses[crashedCloses.length - 1]!;
for (let i = 1; i <= 8; i += 1) crashedCloses.push(Number((last * (1 - 0.08 * i)).toFixed(4)));
const crashed = tradingBars(crashedCloses);
const crashedTrends = captureSectorTrends(crashed);
assert(crashedTrends.some((row) => row.status === "closed"), "breaking daily MA4 closes the box as grey");
const closedCrash = crashedTrends.filter((row) => row.status === "closed").at(-1);
assert(closedCrash && closedCrash.end !== crashed.at(-1)?.time, "the gray box stops before the break day");
const oneAndDone = rising.slice(0, firstStart + 1);
const started = oneAndDone.at(-1)!;
oneAndDone.push({ ...started, time: "2099-01-06", open: 1, high: 1, low: 1, close: 1 });
assert(captureSectorTrends(oneAndDone).length === 0, "a start that breaks the next day leaves no gray stub");
assert(!indexCouldBeOpen(crashed), "a daily close under MA4 is no longer an open trend");
assert(!trendCoversLastBar(crashedTrends, crashed.at(-1)?.time), "a closed box does not cover the latest bar");

const dipCloses = risingCloses();
const dipLast7 = dipCloses.slice(-7);
const belowMa4 = (dipLast7[4]! + dipLast7[5]! + dipLast7[6]!) / 3;
const aboveMa7 = (dipLast7[1]! + dipLast7[2]! + dipLast7[3]! + dipLast7[4]! + dipLast7[5]! + dipLast7[6]!) / 6;
dipCloses.push(Number(((belowMa4 + aboveMa7) / 2).toFixed(4)));
const dipped = tradingBars(dipCloses);
const dipFlags = maStandFlags(dipped).at(-1);
assert(dipFlags && dipFlags.dayBelowMa4 && dipFlags.dayOnMa7, "a dip through MA4 can still stand on MA7");
const dipClosed = captureSectorTrends(dipped);
assert(dipClosed.some((row) => row.status === "closed"), "a daily close under MA4 ends the red box even if MA7 still holds");
assert(!indexCouldBeOpen(dipped), "a dip through daily MA4 is no longer an open trend");

const tooShort = tradingBars(Array.from({ length: 9 }, (_, i) => 100 + i));
assert(captureSectorTrends(tooShort).length === 0, "nine daily bars cannot start a monthly/weekly MA4 box");
assert(!indexCouldBeOpen(tooShort), "a tape shorter than weekly and monthly MA4 cannot be an open red box");

const tenDays = tradingBars(Array.from({ length: 10 }, (_, i) => 100 + i));
const tenFlags = maStandFlags(tenDays).at(-1);
assert(tenFlags && tenFlags.dayOnMa4, "ten rising days stand on daily MA4");
assert(tenFlags && !tenFlags.weekOnMa4 && !tenFlags.monthOnMa4, "ten days are before weekly MA4 and monthly MA4");
assert(captureSectorTrends(tenDays).length === 0, "daily MA4 alone does not start the red box without week and month");
assert(!indexCouldBeOpen(tenDays), "a 10-day rise is not an open red box");

const fourMonths = tradingBars(risingCloses(80));
const fourMonthFlags = maStandFlags(fourMonths).at(-1);
assert(fourMonthFlags && fourMonthFlags.monthOnMa4 && !fourMonthFlags.monthMa4Up, "four months can stand on monthly MA4 before it turns up");
assert(captureSectorTrends(fourMonths).length === 0, "monthly MA4 that is not turning up does not start a red box");
assert(captureSectorTrends(tradingBars(risingCloses(40))).length === 0, "weekly MA4 without monthly MA4 does not start a red box");

const reopenCloses = risingCloses(90);
const reopenLast = reopenCloses[reopenCloses.length - 1]!;
for (let i = 1; i <= 8; i += 1) reopenCloses.push(Number((reopenLast * (1 - 0.08 * i)).toFixed(4)));
for (let i = 1; i <= 90; i += 1) reopenCloses.push(Number((reopenLast * 0.4 + i * 1.2).toFixed(4)));
const reopened = tradingBars(reopenCloses);
const reopenedTrends = captureSectorTrends(reopened);
assert(reopenedTrends.some((row) => row.status === "closed"), "breaking daily MA4 still closes the first box");
assert(reopenedTrends.some((row) => row.status === "open"), "after the gray box, the next month/week/day MA4 stand opens a new red box");

const weekBreakCloses = risingCloses(260);
const weekPeak = weekBreakCloses[weekBreakCloses.length - 1]!;
for (let i = 1; i <= 25; i += 1) weekBreakCloses.push(Number((weekPeak - i * 0.05).toFixed(4)));
const weekBroken = tradingBars(weekBreakCloses);
const weekBreakFlags = maStandFlags(weekBroken).at(-1);
assert(weekBreakFlags && (weekBreakFlags.dayBelowMa4 || weekBreakFlags.weekBelowMa4), "a stall after the rise eventually breaks daily or weekly MA4");
const weekBrokenTrends = captureSectorTrends(weekBroken);
assert(weekBrokenTrends.some((row) => row.status === "closed"), "breaking daily or weekly MA4 closes the red box");
assert(!indexCouldBeOpen(weekBroken), "a close under daily or weekly MA4 is no longer an open trend");

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

const shortBoth = datedBars([...Array.from({ length: 14 }, () => 12), 5, 20]);
const bothWindow = { start: heldLong[6].time, end: heldLong[heldLong.length - 1].time };
const bothMa = listMa4Ma7StandStocks(bothWindow, [
  { code: "sh600001", name: "站久", bars: heldLong },
  { code: "sz000002", name: "刚站上", bars: shortBoth },
]);
assert(bothMa.length === 2, "names standing on both MA4 and MA7 stay in the screener pool");
assert(bothMa[0].name === "刚站上" && bothMa[0].days === 1, "the first day on both MAs sorts first");
assert(bothMa[1].name === "站久" && bothMa[1].days > 1, "a longer both-MA stand sorts after");

const ma4OnlyCloses = [16, 16, 16, 10, 10, 10, 10.5];
const ma4Only = datedBars(ma4OnlyCloses);
assert(
  listMa4CrossStocks({ start: ma4Only[3].time, end: ma4Only[6].time }, [{ code: "sh600004", name: "只站MA4", bars: ma4Only }]).length === 1,
  "a last close under MA7 can still stand on MA4",
);
assert(
  listMa4Ma7StandStocks({ start: ma4Only[3].time, end: ma4Only[6].time }, [{ code: "sh600004", name: "只站MA4", bars: ma4Only }]).length === 0,
  "a last close under MA7 is not a daily MA4+MA7 stand",
);

const missMa10Closes = [16, 16, 16, 12, 12, 12, 12, 12, 12, 12];
const missMa10 = datedBars(missMa10Closes);
const missMa10Window = { start: missMa10[0].time, end: missMa10[missMa10.length - 1].time };
assert(
  listMa4Ma7StandStocks(missMa10Window, [{ code: "sh600005", name: "未站MA10", bars: missMa10 }]).length === 1,
  "a last close under MA10 can still stand on MA4 and MA7",
);
assert(
  listMa4Ma7Ma10StandStocks(missMa10Window, [{ code: "sh600005", name: "未站MA10", bars: missMa10 }]).length === 0,
  "a last close under MA10 is not a daily MA4+MA7+MA10 stand",
);
const allThreeFlat = datedBars(Array.from({ length: 16 }, () => 12));
const allThreeWindow = { start: allThreeFlat[0].time, end: allThreeFlat[allThreeFlat.length - 1].time };
const allThreeHits = listMa4Ma7Ma10StandStocks(allThreeWindow, [{ code: "sh600006", name: "三线都站", bars: allThreeFlat }]);
assert(allThreeHits.length === 1 && allThreeHits[0].days === 7, "a flat tape stands on MA4, MA7 and MA10 from the tenth bar onward");

function fenTouchCloses(price: number): number[] {
  const lead = Array.from({ length: 6 }, () => Math.round((price - 0.5) * 100) / 100);
  const bump = Math.round((price + 0.01) * 100) / 100;
  return [...lead, price, price, bump, price];
}

const fenTouchPool = [
  { code: "sz002239", name: "两元样", price: 2.44 },
  { code: "sh603839", name: "五元样", price: 5.81 },
  { code: "sz002136", name: "十元样", price: 10.21 },
  { code: "sh603638", name: "十八元样", price: 18.29 },
].map((item) => ({
  ...item,
  bars: datedBars(fenTouchCloses(item.price)),
}));
const fenWindow = { start: fenTouchPool[0].bars[0].time, end: fenTouchPool[0].bars.at(-1)!.time };
const fenHits = listMa4Ma7StandStocks(fenWindow, fenTouchPool);
assert(fenHits.length === 4, "every board name with a fen-touch still stands on MA4 and MA7");
assert(
  fenHits.every((row) => row.days === 4),
  "a fen-touch under MA4 does not reset any stock to one day",
);

const batianBars = datedBars([10.21, 9.46, 9.57, 9.37, 9.48, 9.53, 9.56, 9.72, 9.82, 9.85, 9.8, 9.82, 10.21]);
const batianHits = listMa4Ma7StandStocks(
  { start: batianBars[0].time, end: batianBars[batianBars.length - 1].time },
  [{ code: "sz002170", name: "芭田股份", bars: batianBars }],
);
assert(batianHits[0]?.days === 6, "a 0.0025 miss under MA4 does not reset a 芭田-style tape to one day");

console.log("sectorTrend.check ok", {
  start: risingTrends[0].start,
  closedEnd: crashedTrends[0].end,
});
