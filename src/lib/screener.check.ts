import {
  collectMa4StandHits,
  conditionHoldDays,
  consecutiveMa4AboveMa7,
  consecutiveOnMa4,
  dailyToMonthly,
  dailyToWeekly,
  decorateMa4Crosses,
  isScreenerShare,
  ma4CrossedUpMa7,
  matchIndustryBoard,
  monthStandsOnMa4,
  weekStandsOnMa4,
  type SectorMa4Screen,
} from "./screenerLogic.ts";
import { raceDeadline } from "./pool.ts";
import type { KBar, SectorItem } from "./types.ts";

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

const boards = [
  board("881121", "白酒"),
  board("881157", "半导体"),
  board("881171", "自动化设备"),
  board("881128", "汽车服务及其他"),
  board("881125", "汽车整车"),
  board("881126", "汽车零部件"),
];

assert(matchIndustryBoard("白酒", boards)?.code === "881121", "an exact industry name maps to that Tonghuashun board");
assert(matchIndustryBoard("食品饮料-白酒", boards)?.name === "白酒", "a longer F10 name still finds the board");
assert(matchIndustryBoard("酿酒行业", [board("881199", "酿酒"), ...boards])?.name === "酿酒", "dropping the 行业 suffix still finds the board");
assert(matchIndustryBoard("酿酒行业", [board("881107", "白酒"), ...boards])?.name === "白酒", "F10 酿酒 maps onto the Tonghuashun 白酒 board");
assert(matchIndustryBoard("半导体", boards)?.code === "881157", "another industry still matches");
assert(matchIndustryBoard("汽车行业", boards)?.name === "汽车零部件", "F10 汽车行业 maps onto Tonghuashun 汽车零部件");
assert(matchIndustryBoard("未知行业", boards) == null, "an unknown industry does not invent a board");
assert(matchIndustryBoard("  ", boards) == null, "blank industry text is ignored");

function screen(partial: Partial<SectorMa4Screen> & Pick<SectorMa4Screen, "code" | "name">): SectorMa4Screen {
  return {
    onMa4: true,
    lastTime: "2026-10-23",
    openTrend: { start: "2026-10-20", end: "2026-10-23", status: "open" },
    crosses: [],
    members: [],
    ...partial,
  };
}

const short = { code: "sh600001", name: "短站", days: 1, time: "2026-10-23" };
const long = { code: "sh600002", name: "长站", days: 4, time: "2026-10-20" };
const members = [
  { code: "sh600001", name: "短站", price: 10, pct: 1.2, turnover: 2 },
  { code: "sh600002", name: "长站", price: 20, pct: -0.5, turnover: 3 },
];

assert(collectMa4StandHits([screen({ onMa4: false, crosses: [short] })]).length === 0, "index off MA4 is skipped");
assert(
  collectMa4StandHits([screen({ openTrend: { start: "2026-10-01", end: "2026-10-10", status: "closed" }, crosses: [short] })]).length === 0,
  "a closed grey box is skipped",
);
assert(
  collectMa4StandHits([screen({ lastTime: "2026-10-24", crosses: [short] })]).length === 0,
  "a red box that does not cover the last bar is skipped",
);
assert(collectMa4StandHits([screen({ openTrend: null, crosses: [short] })]).length === 0, "no open box means no hits");

const ranked = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [long, short],
    members,
  }),
]);
assert(ranked.length === 2, "both names standing on MA4 are kept");
assert(ranked[0].name === "短站" && ranked[0].days === 1, "the shortest MA4 stand comes first");
assert(ranked[1].name === "长站", "the longer stand is still listed after");
assert(ranked[0].sectorCode === "881121", "the hit keeps the industry board");
assert(ranked[0].price === 10, "price comes from the board roster");

const dup = collectMa4StandHits([
  screen({ code: "881121", name: "半导体", crosses: [{ ...short, days: 3 }], members }),
  screen({ code: "881157", name: "白酒", crosses: [short], members }),
]);
assert(dup.length === 1, "the same name is not listed twice");
assert(dup[0].days === 1 && dup[0].sector === "白酒", "the shorter stand wins when a name sits in two boxes");

assert(isScreenerShare("sh600519", "贵州茅台"), "a Shanghai main-board name stays in the screener");
assert(isScreenerShare("sz000858", "五粮液"), "a Shenzhen main-board name stays in the screener");
assert(!isScreenerShare("sz300750", "宁德时代"), "ChiNext names are dropped");
assert(!isScreenerShare("sh688981", "中芯国际"), "STAR names are dropped");
assert(!isScreenerShare("bj430047", "诺思兰德"), "Beijing names are dropped");
assert(!isScreenerShare("sh600180", "*ST瑞茂"), "ST names are dropped");
assert(!isScreenerShare("sz000002", "ST万科"), "a leading ST tag is dropped");

const stHit = collectMa4StandHits([
  screen({
    code: "881121",
    name: "物流",
    crosses: [{ code: "sh600180", name: "*ST瑞茂", days: 1, time: "2026-10-23" }],
    members: [{ code: "sh600180", name: "*ST瑞茂", price: 4, pct: 1, turnover: 1 }],
  }),
]);
assert(stHit.length === 0, "ST names do not appear in the stand list");

const rankedBoost = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600010", name: "短站无加成", days: 1, time: "2026-10-23" },
      { code: "sh600011", name: "周线", days: 6, time: "2026-10-16", weekOnMa4: true },
      { code: "sh600012", name: "上叉", days: 9, time: "2026-10-13", ma4CrossUpMa7: true },
    ],
    members: [
      { code: "sh600010", name: "短站无加成", price: 10, pct: 1, turnover: 1 },
      { code: "sh600011", name: "周线", price: 11, pct: 1, turnover: 1 },
      { code: "sh600012", name: "上叉", price: 12, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(
  rankedBoost.map((row) => row.name).join(",") === "周线,上叉,短站无加成",
  "the same extra-condition count ranks by shorter daily MA4 stand, then names with fewer extras",
);

const weekBeatsShort = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600020", name: "短", days: 1, time: "2026-10-23" },
      { code: "sh600021", name: "周", days: 8, time: "2026-10-14", weekOnMa4: true },
    ],
    members: [
      { code: "sh600020", name: "短", price: 10, pct: 1, turnover: 1 },
      { code: "sh600021", name: "周", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(weekBeatsShort[0]?.name === "周", "weekly MA4 still ranks ahead of a shorter stand without it");

const monthRank = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600022", name: "短", days: 1, time: "2026-10-23" },
      { code: "sh600023", name: "月线", days: 8, time: "2026-10-14", monthOnMa4: true, monthDays: 1 },
      { code: "sh600024", name: "周线", days: 6, time: "2026-10-16", weekOnMa4: true, weekDays: 2 },
      { code: "sh600025", name: "上叉", days: 9, time: "2026-10-13", ma4CrossUpMa7: true },
    ],
    members: [
      { code: "sh600022", name: "短", price: 10, pct: 1, turnover: 1 },
      { code: "sh600023", name: "月线", price: 11, pct: 1, turnover: 1 },
      { code: "sh600024", name: "周线", price: 12, pct: 1, turnover: 1 },
      { code: "sh600025", name: "上叉", price: 13, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(
  monthRank.map((row) => row.name).join(",") === "周线,月线,上叉,短",
  "one extra condition ranks by shorter daily MA4 stand, then names with none",
);

const freshWeek = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600026", name: "周旧", days: 2, time: "2026-10-22", weekOnMa4: true, weekDays: 5 },
      { code: "sh600027", name: "周新", days: 12, time: "2026-10-08", weekOnMa4: true, weekDays: 1 },
    ],
    members: [
      { code: "sh600026", name: "周旧", price: 10, pct: 1, turnover: 1 },
      { code: "sh600027", name: "周新", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(freshWeek[0]?.name === "周旧", "the same extra conditions rank by shorter daily MA4 stand");

const freshMonth = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600028", name: "月旧", days: 2, time: "2026-10-22", monthOnMa4: true, monthDays: 5 },
      { code: "sh600029", name: "月新", days: 12, time: "2026-10-08", monthOnMa4: true, monthDays: 1 },
    ],
    members: [
      { code: "sh600028", name: "月旧", price: 10, pct: 1, turnover: 1 },
      { code: "sh600029", name: "月新", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(freshMonth[0]?.name === "月旧", "the same extra conditions rank by shorter daily MA4 stand");

const sameFlagsHold = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      {
        code: "sh600032",
        name: "横店样",
        days: 4,
        time: "2026-10-26",
        ma4CrossUpMa7: true,
        weekOnMa4: true,
        monthOnMa4: true,
        weekDays: 1,
        monthDays: 2,
        crossDays: 1,
      },
      {
        code: "sh600033",
        name: "平安样",
        days: 1,
        time: "2026-10-29",
        ma4CrossUpMa7: true,
        weekOnMa4: true,
        monthOnMa4: true,
        weekDays: 1,
        monthDays: 3,
        crossDays: 1,
      },
    ],
    members: [
      { code: "sh600032", name: "横店样", price: 10, pct: 1, turnover: 1 },
      { code: "sh600033", name: "平安样", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(
  sameFlagsHold.map((row) => row.name).join(",") === "平安样,横店样",
  "the same three extras rank by shorter daily MA4 stand",
);
assert(sameFlagsHold[0]?.days === 1 && sameFlagsHold[1]?.days === 4, "持续天数 is the daily close-on-MA4 streak");

const sameWeekMonth = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600034", name: "贵阳样", days: 4, time: "2026-10-26", weekOnMa4: true, monthOnMa4: true, weekDays: 1, monthDays: 3 },
      { code: "sh600035", name: "苏州样", days: 1, time: "2026-10-29", weekOnMa4: true, monthOnMa4: true, weekDays: 1, monthDays: 3 },
    ],
    members: [
      { code: "sh600034", name: "贵阳样", price: 10, pct: 1, turnover: 1 },
      { code: "sh600035", name: "苏州样", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(sameWeekMonth[0]?.name === "苏州样", "the same 周K/月K set ranks by shorter daily MA4 stand");
assert(sameWeekMonth[0]?.days === 1 && sameWeekMonth[1]?.days === 4, "持续天数 is the daily close-on-MA4 streak");

const moreExtras = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600036", name: "两条件短", days: 1, time: "2026-10-29", ma4CrossUpMa7: true, weekOnMa4: true },
      { code: "sh600037", name: "三条件长", days: 9, time: "2026-10-13", ma4CrossUpMa7: true, weekOnMa4: true, monthOnMa4: true },
    ],
    members: [
      { code: "sh600036", name: "两条件短", price: 10, pct: 1, turnover: 1 },
      { code: "sh600037", name: "三条件长", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(moreExtras[0]?.name === "三条件长", "more extra conditions rank first even with a longer daily MA4 stand");

const wave1 = collectMa4StandHits([
  screen({
    code: "881121",
    name: "食品加工制造",
    crosses: [{ code: "sh600040", name: "先扫到", days: 2, time: "2026-10-22" }],
    members: [{ code: "sh600040", name: "先扫到", price: 8, pct: 1, turnover: 1 }],
  }),
]);
assert(wave1.map((row) => row.name).join(",") === "先扫到", "the first wave only has what has been scanned");
const wave2 = collectMa4StandHits([
  screen({
    code: "881121",
    name: "食品加工制造",
    crosses: [{ code: "sh600040", name: "先扫到", days: 2, time: "2026-10-22" }],
    members: [{ code: "sh600040", name: "先扫到", price: 8, pct: 1, turnover: 1 }],
  }),
  screen({
    code: "881171",
    name: "医疗器械",
    crosses: [{ code: "sh600041", name: "后扫上叉", days: 5, time: "2026-10-19", ma4CrossUpMa7: true, weekOnMa4: true }],
    members: [{ code: "sh600041", name: "后扫上叉", price: 9, pct: 1, turnover: 1 }],
  }),
]);
assert(
  wave2.map((row) => row.name).join(",") === "后扫上叉,先扫到",
  "a later board still jumps ahead when it ranks better",
);

function bar(time: string, close: number): KBar {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

const weekBars = [
  ...["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((time) => bar(time, 10)),
  ...["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((time) => bar(time, 11)),
  ...["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].map((time) => bar(time, 12)),
  ...["2026-10-26", "2026-10-27"].map((time) => bar(time, 13)),
];
const weeks = dailyToWeekly(weekBars);
assert(weeks.length === 4, "four calendar weeks collapse into four weekly bars");
assert(weeks[0].time === "2026-10-09" && weeks[0].close === 10, "the first week closes on Friday");
assert(weeks[3].time === "2026-10-27" && weeks[3].close === 13, "the unfinished week still uses the latest close");
assert(weekStandsOnMa4(weekBars), "a rising weekly tape stands on weekly MA4");
assert(!weekStandsOnMa4(weekBars.slice(0, 10)), "fewer than four weekly bars cannot stand on weekly MA4");

const monthBars = [
  ...["2026-07-15", "2026-07-22", "2026-07-31"].map((time) => bar(time, 10)),
  ...["2026-08-07", "2026-08-14", "2026-08-31"].map((time) => bar(time, 11)),
  ...["2026-09-08", "2026-09-18", "2026-09-30"].map((time) => bar(time, 12)),
  ...["2026-10-09", "2026-10-20", "2026-10-29"].map((time) => bar(time, 13)),
];
const months = dailyToMonthly(monthBars);
assert(months.length === 4, "four calendar months collapse into four monthly bars");
assert(months[0].time === "2026-07-31" && months[0].close === 10, "July closes on the last print of the month");
assert(months[3].time === "2026-10-29" && months[3].close === 13, "the unfinished month still uses the latest close");
assert(monthStandsOnMa4(monthBars), "a rising monthly tape stands on monthly MA4");
assert(!monthStandsOnMa4(monthBars.slice(0, 8)), "fewer than four monthly bars cannot stand on monthly MA4");
assert(consecutiveOnMa4([10, 11, 12, 13]) === 1, "four rising closes are the first monthly/weekly bar that can stand on MA4");

const crossCloses = [10, 10, 10, 10, 10, 10, 10, 14];
assert(ma4CrossedUpMa7(crossCloses), "a jump that lifts MA4 through MA7 is a golden cross");
assert(!ma4CrossedUpMa7([10, 10, 10, 10, 10, 10, 10, 10]), "a flat tape is not a MA4/MA7 cross");
assert(consecutiveMa4AboveMa7(crossCloses) === 1, "the cross day is the first day MA4 stays above MA7");
assert(
  conditionHoldDays({
    dailyDays: 4,
    dailySince: "2026-10-26",
    weekOn: true,
    weekDays: 1,
    weekSince: "2026-10-26",
    monthOn: true,
    monthDays: 2,
    monthSince: "2026-09-30",
    cross: true,
    crossDays: 1,
    lastTime: "2026-10-29",
    bars: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"].map((time) => bar(time, 13)),
  }) === 1,
  "the latest condition (the cross) caps how long the whole set has held",
);

const decorated = decorateMa4Crosses(
  [{ code: "sh600030", name: "装饰", days: 2, time: "2026-10-27" }],
  [{ code: "sh600030", bars: weekBars, price: 13 }],
);
assert(decorated[0]?.weekOnMa4 === true, "decorate fills weekly MA4 from the daily tape");
assert(decorated[0]?.monthOnMa4 === false, "four weekly bars in October are not four monthly bars");

const monthDecorated = decorateMa4Crosses(
  [{ code: "sh600031", name: "月装饰", days: 2, time: "2026-10-29" }],
  [{ code: "sh600031", bars: monthBars, price: 13 }],
);
assert(monthDecorated[0]?.monthOnMa4 === true, "decorate fills monthly MA4 from the daily tape");
assert(monthDecorated[0]?.monthDays === 1, "the first qualified month counts as one month on MA4");
assert((monthDecorated[0]?.holdDays ?? 0) >= 1, "decorate fills how long the current conditions have held");

{
  const missed = await raceDeadline(new Promise((resolve) => setTimeout(() => resolve("late"), 80)), 15);
  assert(missed === undefined, "deadline returns undefined while work keeps going");
  const hit = await raceDeadline(Promise.resolve("now"), 50);
  assert(hit === "now", "finished work wins the race");
  const skipped = await raceDeadline(Promise.resolve("now"), 0);
  assert(skipped === undefined, "a zero wait does not block on work");
}

console.log("screener.check ok");
