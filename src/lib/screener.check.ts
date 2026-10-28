import {
  collectMa4StandHits,
  dailyToWeekly,
  decorateMa4Crosses,
  isScreenerShare,
  ma4CrossedUpMa7,
  matchIndustryBoard,
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
  rankedBoost.map((row) => row.name).join(",") === "上叉,周线,短站无加成",
  "MA4 cross up MA7 ranks first, then weekly MA4, then the shortest stand",
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

const crossCloses = [10, 10, 10, 10, 10, 10, 10, 14];
assert(ma4CrossedUpMa7(crossCloses), "a jump that lifts MA4 through MA7 is a golden cross");
assert(!ma4CrossedUpMa7([10, 10, 10, 10, 10, 10, 10, 10]), "a flat tape is not a MA4/MA7 cross");

const decorated = decorateMa4Crosses(
  [{ code: "sh600030", name: "装饰", days: 2, time: "2026-10-27" }],
  [{ code: "sh600030", bars: weekBars, price: 13 }],
);
assert(decorated[0]?.weekOnMa4 === true, "decorate fills weekly MA4 from the daily tape");

{
  const missed = await raceDeadline(new Promise((resolve) => setTimeout(() => resolve("late"), 80)), 15);
  assert(missed === undefined, "deadline returns undefined while work keeps going");
  const hit = await raceDeadline(Promise.resolve("now"), 50);
  assert(hit === "now", "finished work wins the race");
  const skipped = await raceDeadline(Promise.resolve("now"), 0);
  assert(skipped === undefined, "a zero wait does not block on work");
}

console.log("screener.check ok");
