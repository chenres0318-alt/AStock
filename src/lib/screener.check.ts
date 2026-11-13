import {
  collectMa4StandHits,
  collectRibbonHits,
  consecutiveMaRibbonDays,
  dualBoxDays,
  dualBoxMemberIds,
  conditionHoldDays,
  consecutiveMa4AboveMa7,
  consecutiveOnMa4,
  consecutiveOnMa4AndMa7,
  consecutiveOnMa4AndMa7AndMa10,
  dailyToMonthly,
  dailyToWeekly,
  decorateMa4Crosses,
  isFirstWeekOnMa4,
  isScreenerShare,
  ma4CrossedUpMa7,
  maRibbonOk,
  matchIndustryBoard,
  monthStandsOnMa4,
  trendBoxDays,
  weekStandsOnMa4,
  weekStandsOnMa4AndMa7,
  weeksOffMa4Before,
  type SectorMa4Screen,
} from "./screenerLogic.ts";
import { raceDeadline, runDynamicPool } from "./pool.ts";
import { shanghaiTradeDate, withLiveClose } from "./thsRealtime.ts";
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

/** 排名用例默认再挂一个过线概念，避免只测行业时被双红框规则滤掉。 */
function plusConcept(sectors: SectorMa4Screen[]): SectorMa4Screen[] {
  const crosses = new Map<string, SectorMa4Screen["crosses"][number]>();
  const roster = new Map<string, SectorMa4Screen["members"][number]>();
  for (const sector of sectors) {
    for (const cross of sector.crosses) crosses.set(cross.code, cross);
    for (const member of sector.members) roster.set(member.code, member);
  }
  return [
    ...sectors,
    screen({
      code: "885001",
      name: "测试概念",
      crosses: [...crosses.values()],
      members: [...roster.values()],
    }),
  ];
}

function hits(sectors: SectorMa4Screen[]) {
  return collectMa4StandHits(plusConcept(sectors));
}

const dw = { weekOnMa4: true, weekOnMa7: true, weekDays: 1 };
const short = { code: "sh600001", name: "短站", days: 1, time: "2026-10-23", ...dw };
const long = { code: "sh600002", name: "长站", days: 2, time: "2026-10-22", ...dw };
const members = [
  { code: "sh600001", name: "短站", price: 10, pct: 1.2, turnover: 2 },
  { code: "sh600002", name: "长站", price: 20, pct: -0.5, turnover: 3 },
];

assert(
  collectMa4StandHits(
    plusConcept([screen({ code: "881121", name: "半导体", onMa4: false, crosses: [short], members })]),
  ).length === 1,
  "an open red box still hits when the index is off MA4",
);
assert(
  collectMa4StandHits([screen({ openTrend: { start: "2026-10-01", end: "2026-10-10", status: "closed" }, crosses: [short] })]).length === 0,
  "a closed grey box is skipped",
);
assert(
  collectMa4StandHits([screen({ lastTime: "2026-10-24", crosses: [short] })]).length === 0,
  "a red box that does not cover the last bar is skipped",
);
assert(collectMa4StandHits([screen({ openTrend: null, crosses: [short] })]).length === 0, "no open box means no hits");

assert(
  collectMa4StandHits([screen({ code: "881121", name: "半导体", crosses: [short], members })]).length === 0,
  "an industry without a live concept is not a hit",
);

const ranked = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [long, short],
    members,
  }),
]);
assert(ranked.length === 2, "both names standing on MA4 are kept");
assert(ranked[0].name === "短站" && ranked[0].days === 1, "the shortest daily MA4 stand comes first");
assert(ranked[1].name === "长站", "the longer MA4 stand is still listed after");
assert(ranked[0].sectorCode === "881121", "the hit keeps the industry board");
assert(ranked[0].boards.map((item) => item.name).join(",") === "半导体,测试概念", "所属板块 lists the industry then the concept");
assert(ranked[0].price === 10, "price comes from the board roster");

const dup = hits([
  screen({ code: "881121", name: "半导体", crosses: [{ ...short, days: 3 }], members }),
  screen({ code: "881157", name: "白酒", crosses: [short], members }),
]);
assert(dup.length === 1, "the same name is not listed twice");
assert(dup[0].days === 1, "the shorter stand still ranks the row");
assert(dup[0].boards.map((item) => item.name).join(",") === "白酒,半导体,测试概念", "both qualifying industries stay on 所属板块");

const withConcept = collectMa4StandHits([
  screen({ code: "881107", name: "中药", crosses: [short], members }),
  screen({ code: "885799", name: "中药概念", crosses: [short], members }),
]);
assert(withConcept.length === 1, "industry plus concept still collapse to one row");
assert(withConcept[0].sector === "中药" && withConcept[0].sectorCode === "881107", "the industry stays the primary board");
assert(
  withConcept[0].boards.map((item) => `${item.code}:${item.name}`).join(",") === "881107:中药,885799:中药概念",
  "所属板块 lists the industry then the concept",
);
assert(
  collectMa4StandHits([
    screen({ code: "881107", name: "中药", crosses: [short], members }),
    screen({ code: "885799", name: "中药概念", onMa4: false, crosses: [short], members }),
  ]).length === 1,
  "industry plus a concept whose index is off MA4 still hits while the concept box is open",
);

const conceptOnly = collectMa4StandHits([
  screen({ code: "885333", name: "移动支付", crosses: [short], members }),
]);
assert(conceptOnly.length === 0, "a concept without a live industry is not a hit");

const tail = { code: "sh600199", name: "名单尾部", price: 8, pct: 1, turnover: 1 };
const headMembers = Array.from({ length: 40 }, (_, i) => ({
  code: `sh601${String(i).padStart(3, "0")}`,
  name: `头${i}`,
  price: 1,
  pct: 1,
  turnover: 1,
}));
assert(
  dualBoxMemberIds([
    screen({ code: "881121", name: "半导体", members: [...headMembers, tail] }),
    screen({ code: "885001", name: "测试概念", members: [...headMembers.slice(0, 10), tail] }),
  ]).includes("600199"),
  "a name past the old top-40 still counts for dual-box",
);
assert(
  dualBoxMemberIds([
    screen({ code: "881121", name: "半导体", members: headMembers }),
    screen({ code: "885001", name: "测试概念", members: [tail] }),
  ]).length === 0,
  "top-40 industry and a tail-only concept do not intersect",
);
assert(
  collectMa4StandHits([
    screen({
      code: "881121",
      name: "半导体",
      crosses: [{ ...short, code: tail.code, name: tail.name }],
      members: [...headMembers, tail],
    }),
    screen({
      code: "885001",
      name: "测试概念",
      crosses: [{ ...short, code: tail.code, name: tail.name }],
      members: [...headMembers.slice(0, 10), tail],
    }),
  ]).map((row) => row.name).join(",") === "名单尾部",
  "a dual-box name outside the old top 40 still hits",
);
assert(
  collectMa4StandHits([
    screen({
      code: "885333",
      name: "移动支付",
      openTrend: { start: "2026-10-01", end: "2026-10-10", status: "closed" },
      crosses: [short],
      members,
    }),
  ]).length === 0,
  "a concept without a live red box is not a hit",
);

assert(isScreenerShare("sh600519", "贵州茅台"), "a Shanghai main-board name stays in the screener");
assert(isScreenerShare("sz000858", "五粮液"), "a Shenzhen main-board name stays in the screener");
assert(!isScreenerShare("sz300750", "宁德时代"), "ChiNext names are dropped");
assert(!isScreenerShare("sh688981", "中芯国际"), "STAR names are dropped");
assert(!isScreenerShare("bj430047", "诺思兰德"), "Beijing names are dropped");
assert(!isScreenerShare("sh600180", "*ST瑞茂"), "ST names are dropped");
assert(!isScreenerShare("sz000002", "ST万科"), "a leading ST tag is dropped");

function ribbonBars(closes: number[]) {
  return closes.map((close, i) => ({
    time: `2026-10-${String(i + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}
const risingRibbon = Array.from({ length: 16 }, (_, i) => 10 + i);
assert(maRibbonOk(risingRibbon, risingRibbon.length - 1), "a steadily rising tape stacks MA4>MA7>MA10 and turns all three up");
assert(consecutiveMaRibbonDays(risingRibbon) >= 1, "the rising ribbon holds for at least the last bar");
assert(consecutiveMaRibbonDays(Array.from({ length: 16 }, () => 12)) === 0, "a flat tape is not MA4>MA7>MA10");
assert(consecutiveMaRibbonDays(Array.from({ length: 16 }, (_, i) => 20 - i)) === 0, "a declining tape does not have rising MAs");
const firstRibbonDay = [...Array.from({ length: 15 }, () => 10), 20];
assert(consecutiveMaRibbonDays(firstRibbonDay) === 1, "a last-bar jump that stacks and lifts all three MAs is one day");
const ribbonRanked = collectRibbonHits([
  { code: "sh600001", name: "刚排好", bars: ribbonBars(firstRibbonDay), price: 20 },
  { code: "sh600002", name: "排好久", bars: ribbonBars(risingRibbon), price: risingRibbon.at(-1) },
  { code: "sz300001", name: "创业", bars: ribbonBars(firstRibbonDay), price: 20 },
]);
assert(ribbonRanked.map((row) => row.name).join(",") === "刚排好,排好久", "shorter ribbon duration ranks first and ChiNext is dropped");
assert(ribbonRanked[0]?.days === 1 && ribbonRanked[1]?.days > 1, "duration is consecutive days the ribbon conditions hold");

const stHit = collectMa4StandHits([
  screen({
    code: "881121",
    name: "物流",
    crosses: [{ code: "sh600180", name: "*ST瑞茂", days: 1, time: "2026-10-23" }],
    members: [{ code: "sh600180", name: "*ST瑞茂", price: 4, pct: 1, turnover: 1 }],
  }),
]);
assert(stHit.length === 0, "ST names do not appear in the stand list");

const weekMa4Needed = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600010", name: "只有日K", days: 1, time: "2026-10-23" },
      { code: "sh600011", name: "缺周MA7", days: 1, time: "2026-10-23", ...dw, weekOnMa7: false },
      { code: "sh600012", name: "缺周K", days: 1, time: "2026-10-23", monthOnMa4: true },
      { code: "sh600013", name: "缺月K", days: 1, time: "2026-10-23", ...dw, monthOnMa4: false },
      { code: "sh600014", name: "周已两周", days: 1, time: "2026-10-23", ...dw, weekDays: 2 },
      { code: "sh600018", name: "周只空一周", days: 1, time: "2026-10-23", ...dw, weekGap: 1 },
      { code: "sh600019", name: "MA4还在下", days: 1, time: "2026-10-23", ...dw, ma4OnMa7: false },
    ],
    members: [
      { code: "sh600010", name: "只有日K", price: 10, pct: 1, turnover: 1 },
      { code: "sh600011", name: "缺周MA7", price: 11, pct: 1, turnover: 1 },
      { code: "sh600012", name: "缺周K", price: 12, pct: 1, turnover: 1 },
      { code: "sh600013", name: "缺月K", price: 13, pct: 1, turnover: 1 },
      { code: "sh600014", name: "周已两周", price: 14, pct: 1, turnover: 1 },
      { code: "sh600018", name: "周只空一周", price: 18, pct: 1, turnover: 1 },
      { code: "sh600019", name: "MA4还在下", price: 19, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(
  weekMa4Needed.map((row) => row.name).sort().join(",") ===
    ["MA4还在下", "周只空一周", "缺周MA7", "缺月K"].sort().join(","),
  "this week on weekly MA4 after last week off is required; weekly MA7 and monthly MA4 are not",
);
assert(!weekMa4Needed.some((row) => row.name === "周已两周"), "a second consecutive week on MA4 is dropped");
assert(!weekMa4Needed.some((row) => row.name === "只有日K" || row.name === "缺周K"), "missing this-week MA4 is dropped");

const rankedDays = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600032", name: "横店样", days: 2, time: "2026-10-28", ...dw },
      { code: "sh600033", name: "平安样", days: 1, time: "2026-10-29", ...dw },
    ],
    members: [
      { code: "sh600032", name: "横店样", price: 10, pct: 1, turnover: 1 },
      { code: "sh600033", name: "平安样", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(rankedDays.map((row) => row.name).join(",") === "平安样,横店样", "shorter daily MA4 stand ranks first");
assert(rankedDays[0]?.days === 1 && rankedDays[1]?.days === 2, "持续天数 is consecutive daily MA4 stand days");
assert(rankedDays[0]?.holdDays === 1 && rankedDays[1]?.holdDays === 2, "holdDays still copies the stand when decorate is skipped");

assert(
  dualBoxDays({
    boards: [
      { code: "881121", name: "半导体", days: 10 },
      { code: "885001", name: "测试概念", days: 3 },
    ],
  }) === 3,
  "dual box days is the overlap of the industry and concept boxes",
);
assert(
  dualBoxDays({
    boards: [
      { code: "881121", name: "半导体", days: 10 },
      { code: "885001", name: "短概念", days: 3 },
      { code: "885002", name: "长概念", days: 20 },
    ],
  }) === 10,
  "an extra young concept does not shrink the industry-concept overlap",
);
assert(
  trendBoxDays("2026-10-20", "2026-10-23") === 4,
  "calendar box days count the start and end dates",
);
assert(
  trendBoxDays("2026-10-16", "2026-10-23", [
    { time: "2026-10-16" },
    { time: "2026-10-19" },
    { time: "2026-10-20" },
    { time: "2026-10-21" },
    { time: "2026-10-22" },
    { time: "2026-10-23" },
    { time: "2026-10-24" },
  ]) === 6,
  "bar box days skip the weekend and ignore bars outside the box",
);

const boxRanked = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    boxDays: 8,
    openTrend: { start: "2026-10-16", end: "2026-10-23", status: "open" },
    crosses: [{ code: "sh600101", name: "长框", days: 1, time: "2026-10-23", ...dw }],
    members: [{ code: "sh600101", name: "长框", price: 10, pct: 1, turnover: 1 }],
  }),
  screen({
    code: "885801",
    name: "长框概念",
    boxDays: 8,
    openTrend: { start: "2026-10-16", end: "2026-10-23", status: "open" },
    crosses: [{ code: "sh600101", name: "长框", days: 1, time: "2026-10-23", ...dw }],
    members: [{ code: "sh600101", name: "长框", price: 10, pct: 1, turnover: 1 }],
  }),
  screen({
    code: "881122",
    name: "电池",
    boxDays: 2,
    openTrend: { start: "2026-10-22", end: "2026-10-23", status: "open" },
    crosses: [{ code: "sh600102", name: "短框", days: 2, time: "2026-10-22", ...dw }],
    members: [{ code: "sh600102", name: "短框", price: 11, pct: 1, turnover: 1 }],
  }),
  screen({
    code: "885802",
    name: "短框概念",
    boxDays: 3,
    openTrend: { start: "2026-10-21", end: "2026-10-23", status: "open" },
    crosses: [{ code: "sh600102", name: "短框", days: 2, time: "2026-10-22", ...dw }],
    members: [{ code: "sh600102", name: "短框", price: 11, pct: 1, turnover: 1 }],
  }),
]);
assert(boxRanked.map((row) => row.name).join(",") === "长框,短框", "shorter daily MA4 stand ranks first even when its red boxes lasted longer");
assert(boxRanked[0]?.days === 1 && boxRanked[1]?.days === 2, "持续天数 follows daily MA4 stand days, not the red-box overlap");
assert(boxRanked[0]?.holdDays === 1 && boxRanked[1]?.holdDays === 2, "holdDays still copies the stand when decorate is skipped");

const crossDoesNotBeatShort = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600050", name: "无上叉短", days: 1, time: "2026-10-29", ...dw },
      { code: "sh600051", name: "有上叉长", days: 8, time: "2026-10-16", ma4CrossUpMa7: true, ...dw },
    ],
    members: [
      { code: "sh600050", name: "无上叉短", price: 10, pct: 1, turnover: 1 },
      { code: "sh600051", name: "有上叉长", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(
  crossDoesNotBeatShort.map((row) => row.name).join(",") === "无上叉短,有上叉长",
  "a MA4/MA7 cross does not outrank a shorter daily MA4 stand",
);

const twoDurations = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600052", name: "上叉2日", days: 2, time: "2026-10-28", ma4CrossUpMa7: true, ...dw },
      { code: "sh600053", name: "上叉1日", days: 1, time: "2026-10-29", ma4CrossUpMa7: true, ...dw },
    ],
    members: [
      { code: "sh600052", name: "上叉2日", price: 10, pct: 1, turnover: 1 },
      { code: "sh600053", name: "上叉1日", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(twoDurations.map((row) => row.name).join(",") === "上叉1日,上叉2日", "among qualifying names, shorter duration still ranks first");

const weekOnlyLonger = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600036", name: "无周MA7短", days: 1, time: "2026-10-29", ...dw, weekOnMa7: false },
      { code: "sh600037", name: "日周都有", days: 2, time: "2026-10-13", ...dw },
    ],
    members: [
      { code: "sh600036", name: "无周MA7短", price: 10, pct: 1, turnover: 1 },
      { code: "sh600037", name: "日周都有", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(weekOnlyLonger.map((row) => row.name).join(",") === "无周MA7短,日周都有", "weekly MA7 is not required on the first week; shorter daily MA4 stand still ranks first");

const wave1 = collectMa4StandHits([
  screen({
    code: "881121",
    name: "食品加工制造",
    crosses: [{ code: "sh600040", name: "先扫到", days: 2, time: "2026-10-22", ...dw }],
    members: [{ code: "sh600040", name: "先扫到", price: 8, pct: 1, turnover: 1 }],
  }),
]);
assert(wave1.length === 0, "an industry scanned before any live concept does not show yet");
const wave2 = hits([
  screen({
    code: "881121",
    name: "食品加工制造",
    crosses: [{ code: "sh600040", name: "先扫到", days: 2, time: "2026-10-22", ...dw }],
    members: [{ code: "sh600040", name: "先扫到", price: 8, pct: 1, turnover: 1 }],
  }),
  screen({
    code: "881171",
    name: "医疗器械",
    crosses: [{ code: "sh600041", name: "后扫更长", days: 5, time: "2026-10-19", ma4CrossUpMa7: true, ...dw }],
    members: [{ code: "sh600041", name: "后扫更长", price: 9, pct: 1, turnover: 1 }],
  }),
]);
assert(wave2.map((row) => row.name).join(",") === "先扫到,后扫更长", "a later longer MA4 stand still lists after the shorter one");

const bothBeatsOne = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600060", name: "双过长", days: 2, time: "2026-10-22", ...dw },
      { code: "sh600061", name: "只过短", days: 1, time: "2026-10-29", ...dw },
    ],
    members: [
      { code: "sh600060", name: "双过长", price: 10, pct: 1, turnover: 1 },
      { code: "sh600061", name: "只过短", price: 11, pct: 1, turnover: 1 },
    ],
  }),
  screen({
    code: "885001",
    name: "测试概念",
    crosses: [{ code: "sh600060", name: "双过长", days: 2, time: "2026-10-22", ...dw }],
    members: [{ code: "sh600060", name: "双过长", price: 10, pct: 1, turnover: 1 }],
  }),
]);
assert(
  bothBeatsOne.map((row) => row.name).join(",") === "双过长",
  "a name that only has one red box is dropped even with a shorter stand",
);

const overTwo = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600070", name: "刚好2日", days: 2, time: "2026-10-28", ...dw },
      { code: "sh600071", name: "第3日", days: 3, time: "2026-10-27", ...dw },
    ],
    members: [
      { code: "sh600070", name: "刚好2日", price: 10, pct: 1, turnover: 1 },
      { code: "sh600071", name: "第3日", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(overTwo.map((row) => row.name).join(",") === "刚好2日,第3日", "stands longer than two days still list, shorter first");

const ma4Longer = hits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600080", name: "MA4已5日", days: 5, holdDays: 1, time: "2026-10-23", ...dw },
      { code: "sh600081", name: "三线刚1日", days: 1, holdDays: 1, time: "2026-10-23", ...dw },
      { code: "sh600082", name: "三线已3日", days: 4, holdDays: 3, time: "2026-10-23", ...dw },
    ],
    members: [
      { code: "sh600080", name: "MA4已5日", price: 10, pct: 1, turnover: 1 },
      { code: "sh600081", name: "三线刚1日", price: 11, pct: 1, turnover: 1 },
      { code: "sh600082", name: "三线已3日", price: 12, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(
  ma4Longer.map((row) => row.name).join(",") === "三线刚1日,三线已3日,MA4已5日",
  "any daily MA4 stand qualifies; shorter consecutive days still rank first",
);
assert(ma4Longer[0]?.days === 1 && ma4Longer[2]?.days === 5, "持续天数 follows daily MA4 stand even past two days");

const bothByDays = collectMa4StandHits([
  screen({
    code: "881121",
    name: "半导体",
    crosses: [
      { code: "sh600062", name: "双过2日", days: 2, time: "2026-10-28", ...dw },
      { code: "sh600063", name: "双过1日", days: 1, time: "2026-10-29", ...dw },
    ],
    members: [
      { code: "sh600062", name: "双过2日", price: 10, pct: 1, turnover: 1 },
      { code: "sh600063", name: "双过1日", price: 11, pct: 1, turnover: 1 },
    ],
  }),
  screen({
    code: "885001",
    name: "测试概念",
    crosses: [
      { code: "sh600062", name: "双过2日", days: 2, time: "2026-10-28", ...dw },
      { code: "sh600063", name: "双过1日", days: 1, time: "2026-10-29", ...dw },
    ],
    members: [
      { code: "sh600062", name: "双过2日", price: 10, pct: 1, turnover: 1 },
      { code: "sh600063", name: "双过1日", price: 11, pct: 1, turnover: 1 },
    ],
  }),
]);
assert(
  bothByDays.map((row) => row.name).join(",") === "双过1日,双过2日",
  "among names in both red boxes, shorter duration still ranks first",
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
assert(!weekStandsOnMa4AndMa7(weekBars), "four weekly bars cannot stand on weekly MA7");

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
assert(isFirstWeekOnMa4({ weekOnMa4: true, weekDays: 1 }), "this week on MA4 and last week off is the first week");
assert(!isFirstWeekOnMa4({ weekOnMa4: true, weekDays: 2 }), "two consecutive weeks on MA4 is not the first week");
assert(!isFirstWeekOnMa4({ weekOnMa4: false, weekDays: 1 }), "last week off does not count if this week is also off");
assert(!isFirstWeekOnMa4({ weekOnMa4: true }), "this week on MA4 without a 1-week count is not the first week");

assert(consecutiveOnMa4([10, 11, 12, 13]) === 1, "four rising closes are the first monthly/weekly bar that can stand on MA4");
assert(consecutiveOnMa4AndMa7([10, 11, 12, 13, 14, 15, 16]) === 1, "seven rising closes are the first bar that can stand on MA4 and MA7");
assert(consecutiveOnMa4AndMa7(Array.from({ length: 10 }, () => 12)) === 4, "a flat tape stands on both MAs from the seventh bar onward");
assert(consecutiveOnMa4AndMa7([10, 11, 12, 13, 14, 15, 9]) === 0, "a last close under MA7 is not standing on both");
assert(consecutiveOnMa4AndMa7AndMa10(Array.from({ length: 10 }, (_, i) => 10 + i)) === 1, "ten rising closes are the first bar that can stand on MA4, MA7 and MA10");
assert(consecutiveOnMa4AndMa7AndMa10(Array.from({ length: 14 }, () => 12)) === 5, "a flat tape stands on MA4, MA7 and MA10 from the tenth bar onward");
assert(consecutiveOnMa4AndMa7AndMa10([16, 16, 16, 12, 12, 12, 12, 12, 12, 12]) === 0, "a last close under MA10 is not standing on all three");
assert(consecutiveOnMa4AndMa7([16, 16, 16, 12, 12, 12, 12, 12, 12, 12]) === 1, "the same tape still stands on MA4 and MA7");
function fenTouchCloses(price: number): number[] {
  const lead = Array.from({ length: 6 }, () => Math.round((price - 0.5) * 100) / 100);
  const bump = Math.round((price + 0.01) * 100) / 100;
  return [...lead, price, price, bump, price];
}

for (const price of [2.44, 5.81, 9.82, 10.21, 18.29]) {
  const closes = fenTouchCloses(price);
  assert(
    consecutiveOnMa4AndMa7(closes) === 4,
    `a fen-touch under MA4 at ${price} still counts as standing for any stock`,
  );
  assert(
    consecutiveOnMa4AndMa7(closes, price * 1.8) === 4,
    `an unadjusted live quote far above ${price} is ignored`,
  );
}

const batianCloses = [10.21, 9.46, 9.57, 9.37, 9.48, 9.53, 9.56, 9.72, 9.82, 9.85, 9.8, 9.82, 10.21];
assert(
  consecutiveOnMa4AndMa7(batianCloses) === 6,
  "a 0.0025 miss under MA4 still counts as standing, so a 芭田-style tape is six days not one",
);
assert(
  consecutiveOnMa4AndMa7([...fenTouchCloses(9.82).slice(0, -1), 9.81]) === 0,
  "a full fen under MA4 still breaks the stand",
);

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
assert(decorated[0]?.weekOnMa7 === false, "four weekly bars are not enough for weekly MA7");
assert(decorated[0]?.monthOnMa4 === false, "four weekly bars in October are not four monthly bars");

function tradingBars(closes: number[], start = "2026-08-31"): KBar[] {
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
    bars.push(bar(time, closes[i]));
  }
  return bars;
}

const weekMa7Bars = tradingBars(Array.from({ length: 40 }, (_, i) => 10 + Math.floor(i / 5)));
assert(dailyToWeekly(weekMa7Bars).length === 8, "eight calendar weeks collapse into eight weekly bars");
assert(weekStandsOnMa4AndMa7(weekMa7Bars), "eight rising weekly bars stand on weekly MA4 and MA7");
const weekMa7Decorated = decorateMa4Crosses(
  [{ code: "sh600034", name: "周MA7", days: 2, time: weekMa7Bars.at(-1)!.time }],
  [{ code: "sh600034", bars: weekMa7Bars, price: weekMa7Bars.at(-1)!.close }],
);
assert(weekMa7Decorated[0]?.weekOnMa4 === true && weekMa7Decorated[0]?.weekOnMa7 === true, "decorate fills weekly MA4 and MA7");
assert((weekMa7Decorated[0]?.weekDays ?? 0) > 1, "a rising weekly tape has already stood more than the first week");
assert((weekMa7Decorated[0]?.holdDays ?? 0) >= 1, "decorate fills how long daily MA4, MA7 and MA10 have held together");
assert((weekMa7Decorated[0]?.days ?? 0) >= (weekMa7Decorated[0]?.holdDays ?? 0), "MA4 stand days are at least as long as the all-three stand");

const firstWeekBars = tradingBars([
  ...Array.from({ length: 15 }, () => 10),
  ...Array.from({ length: 10 }, () => 8),
  ...Array.from({ length: 5 }, () => 12),
]);
const firstWeekDecorated = decorateMa4Crosses(
  [{ code: "sh600038", name: "首周", days: 1, time: firstWeekBars.at(-1)!.time }],
  [{ code: "sh600038", bars: firstWeekBars, price: 12 }],
);
assert(
  firstWeekDecorated[0]?.weekOnMa4 === true &&
    firstWeekDecorated[0]?.weekDays === 1 &&
    (firstWeekDecorated[0]?.weekGap ?? 0) >= 2,
  "this week on MA4 after two weeks off is a real first week",
);

const oneWeekWiggleBars = tradingBars([
  ...Array.from({ length: 15 }, () => 10),
  ...Array.from({ length: 5 }, () => 8),
  ...Array.from({ length: 5 }, () => 12),
]);
const oneWeekWiggleDecorated = decorateMa4Crosses(
  [{ code: "sh600042", name: "招商样", days: 1, time: oneWeekWiggleBars.at(-1)!.time }],
  [{ code: "sh600042", bars: oneWeekWiggleBars, price: 12 }],
);
assert(
  oneWeekWiggleDecorated[0]?.weekOnMa4 === true &&
    oneWeekWiggleDecorated[0]?.weekDays === 1 &&
    (oneWeekWiggleDecorated[0]?.weekGap ?? 0) === 1,
  "a one-week dip then reclaim is not a two-week gap",
);
assert(
  weeksOffMa4Before(dailyToWeekly(oneWeekWiggleBars).map((item) => item.close)) === 1,
  "招商公路-style weekly tape only left MA4 for one week",
);

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

{
  const pending: number[] = [];
  const seen: number[] = [];
  let closed = false;
  let waiters: Array<() => void> = [];
  const wake = () => {
    const list = waiters;
    waiters = [];
    for (const resolve of list) resolve();
  };
  const producer = (async () => {
    for (const value of [1, 2, 3, 4]) {
      pending.push(value);
      wake();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    closed = true;
    wake();
  })();
  await Promise.all([
    producer,
    runDynamicPool(2, {
      pull: () => pending.shift(),
      closed: () => closed && pending.length === 0,
      wait: () => {
        if (closed || pending.length) return Promise.resolve();
        return new Promise<void>((resolve) => waiters.push(resolve));
      },
      work: async (value) => {
        seen.push(value);
        await new Promise((resolve) => setTimeout(resolve, 8));
      },
    }),
  ]);
  assert(seen.slice().sort().join(",") === "1,2,3,4", "dynamic pool works items as they arrive");
  assert(seen[0] === 1, "the first queued item starts before the producer finishes");
}

const firstStandBars = [
  bar("2026-11-06", 10),
  bar("2026-11-09", 10),
  bar("2026-11-10", 10),
  bar("2026-11-11", 9),
  bar("2026-11-12", 12),
];
assert(consecutiveOnMa4(firstStandBars.map((item) => item.close)) === 1, "Thursday is the first close on MA4");
const overnightFirst = withLiveClose(
  firstStandBars,
  12,
  shanghaiTradeDate(new Date("2026-11-13T01:14:00+08:00")),
);
assert(overnightFirst.at(-1)?.time === "2026-11-12", "before the open, live price does not add a Friday bar");
assert(
  consecutiveOnMa4(overnightFirst.map((item) => item.close), 12) === 1,
  "a first day on MA4 stays one day overnight instead of becoming two",
);
const afterOpenFirst = withLiveClose(
  firstStandBars,
  12.2,
  shanghaiTradeDate(new Date("2026-11-13T09:30:00+08:00")),
);
assert(afterOpenFirst.at(-1)?.time === "2026-11-13", "after 9:15 a new print becomes a new daily bar");

console.log("screener.check ok");
