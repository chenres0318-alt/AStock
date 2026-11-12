import { isTonghuashunBoard, isTonghuashunConcept, isTonghuashunIndustry } from "./codes.ts";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  listMa4CrossStocks,
  listMa4Ma7StandStocks,
  listMa4Ma7Ma10StandStocks,
  openPriceTrend,
  standsOnMa4,
  trendCoversLastBar,
  type SectorMemberPath,
} from "./sectorTrend.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function barsFromCloses(closes: number[], lows?: number[]): KBar[] {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1];
    const open = prev;
    const low = lows?.[i] ?? Math.min(open, close) * 0.998;
    const high = Math.max(open, close) * 1.002;
    const day = String((i % 28) + 1).padStart(2, "0");
    return {
      time: `2026-03-${day}-${i}`,
      open,
      high,
      low,
      close,
      volume: 1000,
    };
  });
}

/** 龙头每天比指数多抬一点；其余跟风与指数同涨。downFrom 之后的名字一路下跌。 */
function membersFollowing(bars: KBar[], downFrom = 10): SectorMemberPath[] {
  return Array.from({ length: 10 }, (_, index) => {
    const closes = new Map<string, number>();
    bars.forEach((bar, i) => {
      const close = index === 0 ? bar.close * (1 + 0.015 * i) : index >= downFrom ? 100 - i : bar.close;
      closes.set(bar.time, close);
    });
    return { code: `sh60000${index}`, name: index === 0 ? "龙头" : `跟风${index}`, closes };
  });
}

function rise(start: number, steps: number[], after: number[] = []): number[] {
  const closes = Array.from({ length: 8 }, () => start);
  let price = start;
  for (const step of steps) {
    price = Number((price * step).toFixed(4));
    closes.push(price);
  }
  for (const step of after) {
    price = Number((price * step).toFixed(4));
    closes.push(price);
  }
  return closes;
}

const quiet = barsFromCloses(Array.from({ length: 24 }, (_, i) => 100 + Math.sin(i) * 0.3));
assert(captureSectorTrends(quiet, membersFollowing(quiet)).length === 0, "a tight sideways range is not a trend");

const pulse = barsFromCloses(rise(100, [1.04, 1.05], [0.9]));
assert(
  captureSectorTrends(pulse, membersFollowing(pulse)).length === 0,
  "a short pop without a leader ahead of the sector draws nothing",
);

/** 龙头从启动那根开始比指数高出一截，用来检验启动日当天就能画框。 */
function membersAheadFrom(bars: KBar[], aheadIndex: number): SectorMemberPath[] {
  return Array.from({ length: 8 }, (_, index) => {
    const closes = new Map<string, number>();
    bars.forEach((bar, i) => {
      closes.set(bar.time, index === 0 && i >= aheadIndex ? bar.close * 1.06 : bar.close);
    });
    return { code: `sh60000${index}`, name: index === 0 ? "龙头" : `跟风${index}`, closes };
  });
}

function withLaunchLow(closes: number[]): KBar[] {
  const launchAt = closes.findIndex((close, index) => index > 0 && close !== closes[index - 1]);
  return barsFromCloses(
    closes,
    closes.map((close, index) => (index >= launchAt ? close * 0.995 : close * 0.998)),
  );
}

const launchCloses = rise(100, [1.03]);
const launch = withLaunchLow(launchCloses);
const launchAt = launch.findIndex((bar, index) => index > 0 && bar.close !== launch[index - 1].close);
const launchTrends = captureSectorTrends(launch, membersAheadFrom(launch, launchAt));
assert(
  launchTrends.length === 1 && launchTrends[0].status === "open" && launchTrends[0].end === launch.at(-1)?.time,
  "the launch day itself draws an open box through that bar",
);
const launchStart = launch.findIndex((bar) => bar.time === launchTrends[0].start);
const launchEnd = launch.findIndex((bar) => bar.time === launchTrends[0].end);
assert(launchEnd - launchStart === 1, "the box spans the low and the first up day only");
assert(indexCouldBeOpen(launch), "the launch day still looks open on price alone");
assert(openPriceTrend(launch)?.end === launch.at(-1)?.time, "price-only window covers the latest bar on launch");

const smallLaunch = withLaunchLow(rise(100, [1.01]));
const smallAt = smallLaunch.findIndex((bar, index) => index > 0 && bar.close !== smallLaunch[index - 1].close);
assert(
  captureSectorTrends(smallLaunch, membersAheadFrom(smallLaunch, smallAt)).length === 0,
  "a first up day that has not gained 2% draws nothing",
);

const fadedCloses = rise(100, [1.03], [0.9]);
const faded = withLaunchLow(fadedCloses);
const fadedAt = faded.findIndex((bar, index) => index > 0 && bar.close !== faded[index - 1].close);
assert(
  captureSectorTrends(faded, membersAheadFrom(faded, fadedAt)).length === 0,
  "a launch that breaks the next day is a failed pulse, not a gray box",
);

const held = barsFromCloses(rise(100, [1.02, 1.02, 1.02, 1.02, 1.015]));
const heldTrends = captureSectorTrends(held, membersFollowing(held));
assert(heldTrends.length === 1 && heldTrends[0].status === "open", "a rise that is still near its high stays an open red box");
assert(heldTrends[0].end === held.at(-1)?.time, "the open box runs through the latest bar");
assert(heldTrends[0].gain >= 0.02, "the open box clears the gain floor");
assert(heldTrends[0].leaders[0]?.name === "龙头", "the strongest name in the window is the leader");

const finishedCloses = rise(100, [1.02, 1.02, 1.02, 1.02, 1.015], [0.985, 0.985, 0.99]);
const finished = barsFromCloses(finishedCloses);
const finishedTrends = captureSectorTrends(finished, membersFollowing(finished));
assert(finishedTrends.length === 1 && finishedTrends[0].status === "closed", "a pullback that keeps the start low closes the box");
const peak = finished.reduce((best, bar, index) => (bar.close > finished[best].close ? index : best), 0);
assert(finishedTrends[0].end === finished[peak].time, "a closed box ends on the high, not on the pullback");

const early = barsFromCloses(rise(100, [1.02, 1.02, 1.02, 1.02]));
const earlyTrends = captureSectorTrends(early, membersFollowing(early));
assert(
  earlyTrends.length === 1 && earlyTrends[0].status === "open" && earlyTrends[0].end === early.at(-1)?.time,
  "the box is drawn on the first day the rules pass and runs through that bar",
);

const broken = barsFromCloses(rise(100, [1.02, 1.02, 1.02, 1.02, 1.02], [0.9]));
const brokenTrends = captureSectorTrends(broken, membersFollowing(broken));
const brokenPeak = broken.reduce((best, bar, index) => (bar.close > broken[best].close ? index : best), 0);
assert(brokenTrends.length === 1 && brokenTrends[0].status === "closed", "a qualified rise that later breaks the start stays on the chart");
assert(brokenTrends[0].end === broken[brokenPeak].time, "that box ends on the high before the break");

const weakIndex = barsFromCloses(rise(100, [1.02, 1.02, 1.02, 1.02, 1.02]));
assert(
  captureSectorTrends(weakIndex, membersFollowing(weakIndex, 2)).length === 0,
  "an index rise with most members down is not a sector trend",
);
const noLeader = membersFollowing(weakIndex).map((member) => {
  const closes = new Map<string, number>();
  weakIndex.forEach((bar) => closes.set(bar.time, bar.close));
  return { ...member, closes };
});
assert(
  captureSectorTrends(weakIndex, noLeader).length === 0,
  "a rise without a leader ahead of the index is not a sector trend",
);

assert(indexCouldBeOpen(held), "an in-progress rise still looks open on price alone");
assert(indexCouldBeOpen(early), "the first qualifying day already looks open on price alone");
assert(!indexCouldBeOpen(broken), "a break of the start low is no longer an open trend");
assert(!indexCouldBeOpen(finished), "a pullback that closed the box does not cover the latest bar");
assert(!indexCouldBeOpen(pulse), "a spike that never qualified is not an open trend");
assert(!indexCouldBeOpen(quiet), "sideways chop is not an open trend");
assert(trendCoversLastBar(heldTrends, held.at(-1)?.time), "an open box covers the latest bar");
assert(!trendCoversLastBar(finishedTrends, finished.at(-1)?.time), "a closed box ends at the high and does not cover a later bar");
assert(!trendCoversLastBar(brokenTrends, broken.at(-1)?.time), "a box closed by a break does not cover the latest bar");
assert(captureSectorTrends(held, []).length === 0, "drawing the box still needs constituents");

function kbar(i: number, close: number, low: number, high: number, open = close): KBar {
  return {
    time: `2026-04-${String((i % 28) + 1).padStart(2, "0")}-${i}`,
    open,
    high,
    low,
    close,
    volume: 1000,
  };
}

const flats = Array.from({ length: 8 }, (_, i) => kbar(i, 100, 99.5, 100.4));
const reversal = [...flats, kbar(8, 103, 96, 104, 100)];
const reversalTrends = captureSectorTrends(reversal, membersAheadFrom(reversal, 8));
assert(
  reversalTrends.length === 1 &&
    reversalTrends[0].status === "open" &&
    reversalTrends[0].start === reversal.at(-1)?.time &&
    reversalTrends[0].end === reversal.at(-1)?.time,
  "a low day that closes back near the high is a suspected launch",
);
assert(reversalTrends[0].gain > 0.02, "the suspected launch uses that day's gain");
assert(indexCouldBeOpen(reversal), "the low day still looks open on price alone");
assert(trendCoversLastBar(reversalTrends, reversal.at(-1)?.time), "the suspected launch covers the latest bar");

const wick = [...flats, kbar(8, 100.5, 97, 101, 99.6)];
const wickTrends = captureSectorTrends(wick, membersAheadFrom(wick, 8));
assert(
  wickTrends.length === 1 && wickTrends[0].start === wick.at(-1)?.time && wickTrends[0].end === wick.at(-1)?.time,
  "a dip that closes up, with the rebound already past 2%, is a suspected launch",
);

const softClose = [...flats, kbar(8, 97, 96, 104, 100)];
assert(
  captureSectorTrends(softClose, membersAheadFrom(softClose, 8)).length === 0,
  "a low day that closes near the low is not a launch",
);
assert(!indexCouldBeOpen(softClose), "a weak close on the low day is not an open trend");

const brokenLow = [...reversal, kbar(9, 94, 93, 97, 103)];
assert(
  captureSectorTrends(brokenLow, membersAheadFrom(brokenLow, 8)).length === 0,
  "the suspected launch is withdrawn when the next day undercuts the low",
);

const heldLow = [...reversal, kbar(9, 104, 100, 105, 103)];
const heldLowTrends = captureSectorTrends(heldLow, membersAheadFrom(heldLow, 8));
assert(
  heldLowTrends.length === 1 &&
    heldLowTrends[0].status === "open" &&
    heldLowTrends[0].start === reversal.at(-1)?.time &&
    heldLowTrends[0].end === heldLow.at(-1)?.time,
  "once the next day holds the low, the box stays and runs through the latest bar",
);

/** 锤线低点之后先回一下再拉起来，应画成一段，而不是收在锤线当天。 */
const vBottom = [
  ...flats,
  kbar(8, 103, 96, 104, 100),
  kbar(9, 101, 99, 102, 103),
  kbar(10, 100.5, 99.2, 101.5, 101),
  kbar(11, 103.5, 100.8, 104, 100.5),
  kbar(12, 106, 103, 106.5, 103.5),
  kbar(13, 108, 105.5, 108.5, 106),
  kbar(14, 109.5, 107.5, 110, 108),
  kbar(15, 108.2, 107.8, 109.8, 109.5),
  kbar(16, 106.4, 106, 108.4, 108.2),
];
const vTrends = captureSectorTrends(vBottom, membersFollowing(vBottom));
assert(
  vTrends.length === 1 &&
    vTrends[0].status === "closed" &&
    vTrends[0].start === vBottom[8].time &&
    vTrends[0].end === vBottom[14].time,
  "a hammer plus a later rally is one closed swing from the low to the high",
);
assert(vTrends[0].gain >= 0.05, "that swing clears the closed-box gain floor");

/** 下跌里 4 根 4% 的反弹，走完后丢掉。 */
const shortBounce = [
  ...flats,
  kbar(8, 96, 95.5, 98, 100),
  kbar(9, 97, 96.2, 97.5, 96),
  kbar(10, 98.5, 96.8, 99, 97),
  kbar(11, 99.9, 98, 100.2, 98.5),
  kbar(12, 97.2, 96.8, 99.5, 99.9),
];
assert(
  captureSectorTrends(shortBounce, membersFollowing(shortBounce)).length === 0,
  "a 4-day 4% bounce that already gave back is not kept as a gray box",
);

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

function k(time: string, open: number, high: number, low: number, close: number): KBar {
  return { time, open, high, low, close, volume: 1 };
}

/** 半导体 10-19 到 10-23：假周六会挡住 10-23 当天启动。 */
const semi = [
  k("2026-10-16", 14055, 14064, 13510, 13627),
  k("2026-10-19", 13529, 13678, 13142, 13537),
  k("2026-10-20", 13495, 14139, 13420, 13933),
  k("2026-10-21", 14076, 14256, 13883, 13948),
  k("2026-10-22", 13968, 14009, 13475, 13535),
  k("2026-10-23", 13240, 14088, 12788, 14029),
];
const semiMembers = membersAheadFrom(semi, semi.length - 1);
const semiLive = captureSectorTrends(semi, semiMembers);
assert(
  semiLive.some((item) => item.status === "open" && item.start === "2026-10-23" && item.end === "2026-10-23"),
  "Oct 23 itself is an open launch when it is the last bar",
);
assert(trendCoversLastBar(semiLive, "2026-10-23"), "the open launch still covers the latest trading day");
const semiFake = [...semi, { ...semi.at(-1)!, time: "2026-10-24" }];
const semiBlocked = captureSectorTrends(semiFake, membersAheadFrom(semiFake, semiFake.length - 2));
assert(
  !trendCoversLastBar(semiBlocked, semiFake.at(-1)?.time) &&
    !semiBlocked.some((item) => item.status === "open" && item.start === "2026-10-23"),
  "a Saturday clone of Oct 23 blocks that launch and leaves no open box on the last bar",
);

console.log("sectorTrend.check ok", {
  open: heldTrends[0].gain,
  closed: finishedTrends[0].gain,
});
