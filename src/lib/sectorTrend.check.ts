import { isTonghuashunBoard, isTonghuashunConcept, isTonghuashunIndustry } from "./codes.ts";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  listMa4CrossStocks,
  listMa4Ma7StandStocks,
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

/** 足够长的抬升，让日 K 和周 K 都能站上 MA4 和 MA7。 */
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
const firstStart = risingFlags.findIndex((row) => row.dayOnMa4 && row.dayOnMa7 && row.weekOnMa4 && row.weekOnMa7);
assert(firstStart >= 0, "a long rise eventually stands on daily and weekly MA4/MA7");
const risingTrends = captureSectorTrends(rising, membersFollowing(rising));
assert(risingTrends.length === 1 && risingTrends[0].status === "open", "the MA alignment opens one red box");
assert(risingTrends[0].start === rising[firstStart].time, "the box starts on the first day daily and weekly MA4/MA7 stand");
assert(risingTrends[0].end === rising.at(-1)?.time, "the open box runs through the latest bar");
assert(risingTrends[0].leaders[0]?.name === "龙头", "member breadth still names the leader inside the box");
assert(indexCouldBeOpen(rising), "the rise still looks open on the index alone");
assert(indexCouldBeOpen(rising.slice(-120)), "a short recent window still sees an open box");
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
assert(crashedTrends.some((row) => row.status === "closed"), "breaking both daily MA4 and MA7 closes the box as grey");
const closedCrash = crashedTrends.filter((row) => row.status === "closed").at(-1);
assert(closedCrash && closedCrash.end !== crashed.at(-1)?.time, "the gray box stops before the break day");
const oneAndDone = rising.slice(0, firstStart + 1);
const started = oneAndDone.at(-1)!;
oneAndDone.push({ ...started, time: "2099-01-06", open: 1, high: 1, low: 1, close: 1 });
assert(captureSectorTrends(oneAndDone).length === 0, "a start that breaks the next day leaves no gray stub");
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
assert(indexCouldBeOpen(dipped), "a dip through only MA4 keeps the red box open");

const tooShort = tradingBars(Array.from({ length: 6 }, (_, i) => 100 + i));
assert(captureSectorTrends(tooShort).length === 0, "fewer than 7 daily bars cannot stand on MA7");
assert(!indexCouldBeOpen(tooShort), "a tape shorter than MA7 cannot be an open red box");

const threeWeeks = tradingBars(Array.from({ length: 14 }, (_, i) => 100 + i));
assert(captureSectorTrends(threeWeeks).length === 0, "fewer than 4 weekly bars cannot stand on weekly MA4");
assert(!indexCouldBeOpen(threeWeeks), "a 3-week rise cannot start the red box");

const shortDaily = tradingBars(Array.from({ length: 25 }, (_, i) => 100 + i));
assert(captureSectorTrends(shortDaily).length === 0, "fewer than 7 weekly bars cannot stand on weekly MA7");
assert(!indexCouldBeOpen(shortDaily), "a 25-day rise cannot start the red box");

const sevenWeeks = tradingBars(Array.from({ length: 40 }, (_, i) => 100 + i));
const sevenWeekFlags = maStandFlags(sevenWeeks);
const sevenWeekStart = sevenWeekFlags.findIndex((row) => row.dayOnMa4 && row.dayOnMa7 && row.weekOnMa4 && row.weekOnMa7);
assert(sevenWeekStart >= 0, "seven rising weeks can stand on weekly MA4 and MA7");
const sevenWeekTrends = captureSectorTrends(sevenWeeks);
assert(sevenWeekTrends.length === 1 && sevenWeekTrends[0].status === "open", "daily MA4/MA7 plus weekly MA4/MA7 start the red box");
assert(indexCouldBeOpen(sevenWeeks), "a 7-week rise can be an open red box");

const threeMonths = tradingBars(Array.from({ length: 62 }, (_, i) => 100 + i));
assert(captureSectorTrends(threeMonths).length === 1 && captureSectorTrends(threeMonths)[0].status === "open", "monthly MA4 is not required to start");
assert(indexCouldBeOpen(threeMonths), "a 3-month rise can be an open red box without monthly MA4");

const reopenCloses = risingCloses(90);
const reopenLast = reopenCloses[reopenCloses.length - 1]!;
for (let i = 1; i <= 8; i += 1) reopenCloses.push(Number((reopenLast * (1 - 0.08 * i)).toFixed(4)));
for (let i = 1; i <= 90; i += 1) reopenCloses.push(Number((reopenLast * 0.4 + i * 1.2).toFixed(4)));
const reopened = tradingBars(reopenCloses);
const reopenedTrends = captureSectorTrends(reopened);
assert(reopenedTrends.some((row) => row.status === "closed"), "breaking both daily MAs still closes the first box");
assert(reopenedTrends.some((row) => row.status === "open"), "after the gray box, the next daily and weekly MA4/MA7 stand opens a new red box");

const weekBreakCloses = Array.from({ length: 40 }, () => 20);
for (let i = 0; i < 5; i += 1) weekBreakCloses.push(19.95);
const weekBroken = tradingBars(weekBreakCloses);
const weekBreakFlags = maStandFlags(weekBroken).at(-1);
assert(weekBreakFlags && weekBreakFlags.dayOnMa4 && !weekBreakFlags.weekOnMa4 && !weekBreakFlags.weekOnMa7, "a flat down week can stay on daily MA4 while weekly MA4 and MA7 break");
const weekBrokenTrends = captureSectorTrends(weekBroken);
assert(weekBrokenTrends.some((row) => row.status === "closed"), "breaking both weekly MA4 and MA7 also closes the red box");
assert(!indexCouldBeOpen(weekBroken), "both weekly averages broken is no longer an open trend");

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
