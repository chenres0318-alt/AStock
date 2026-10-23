import { isTonghuashunBoard, isTonghuashunConcept, isTonghuashunIndustry } from "./codes.ts";
import { captureSectorTrends, indexCouldBeOpen, listMa4CrossStocks, trendCoversLastBar, type SectorMemberPath } from "./sectorTrend.ts";
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

const smallLaunch = withLaunchLow(rise(100, [1.01]));
const smallAt = smallLaunch.findIndex((bar, index) => index > 0 && bar.close !== smallLaunch[index - 1].close);
assert(
  captureSectorTrends(smallLaunch, membersAheadFrom(smallLaunch, smallAt)).length === 0,
  "a first up day that has not gained 2% draws nothing",
);

const fadedCloses = rise(100, [1.03], [0.9]);
const faded = withLaunchLow(fadedCloses);
const fadedAt = faded.findIndex((bar, index) => index > 0 && bar.close !== faded[index - 1].close);
const fadedTrends = captureSectorTrends(faded, membersAheadFrom(faded, fadedAt));
assert(
  fadedTrends.length === 1 && fadedTrends[0].status === "closed" && fadedTrends[0].end === faded[fadedAt].time,
  "a launch that breaks the next day stays as a gray box ending on the launch day",
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
assert(
  trendCoversLastBar(heldTrends, held.at(-1)?.time),
  "an open box covers the latest bar",
);
assert(
  !trendCoversLastBar(finishedTrends, finished.at(-1)?.time),
  "a closed box ends at the high and does not cover a later bar",
);
assert(
  !trendCoversLastBar(brokenTrends, broken.at(-1)?.time),
  "a box closed by a break does not cover the latest bar",
);

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

assert(isTonghuashunIndustry("881121") && !isTonghuashunConcept("881121"), "an industry code stays an industry");
assert(isTonghuashunConcept("885457") && isTonghuashunConcept("886056"), "concept indexes use 885 and 886");
assert(isTonghuashunBoard("881121") && isTonghuashunBoard("885457"), "both industry and concept boards can open the trend page");
assert(!isTonghuashunBoard("601138"), "a stock code is not a Tonghuashun board");

console.log("sectorTrend.check ok", {
  open: heldTrends[0].gain,
  closed: finishedTrends[0].gain,
});

function isoBar(time: string, close: number): KBar {
  return { time, open: close, high: close, low: close, close, volume: 1000 };
}

function datedBars(closes: number[], start = "2026-01-02"): KBar[] {
  const origin = Date.parse(`${start}T00:00:00Z`);
  return closes.map((close, index) => {
    const time = new Date(origin + index * 86_400_000).toISOString().slice(0, 10);
    return isoBar(time, close);
  });
}

function downThenUp(down = 40, up = 6, start = 20, downStep = 0.4, upStep = 1.8): number[] {
  const closes: number[] = [];
  let price = start;
  for (let i = 0; i < down; i += 1) {
    price *= 1 - downStep / 100;
    closes.push(Number(price.toFixed(4)));
  }
  for (let i = 0; i < up; i += 1) {
    price *= 1 + upStep / 100;
    closes.push(Number(price.toFixed(4)));
  }
  return closes;
}

const bounce = datedBars(downThenUp());
const bounceTimes = bounce.map((bar) => bar.time);
const crossTime = bounceTimes[41];
const day2 = bounceTimes[42];
const day3 = bounceTimes[43];
const lastTime = bounceTimes[45];

const day1Hit = listMa4CrossStocks({ start: bounceTimes[40], end: crossTime }, [{ code: "sh600001", name: "金叉", bars: bounce }]);
assert(day1Hit.length === 1 && day1Hit[0].time === crossTime, "stand above MA4/MA7, a same-day 4/7 cross, and a red MACD bar is kept");

assert(
  listMa4CrossStocks({ start: bounceTimes[40], end: day2 }, [{ code: "sh600001", name: "金叉", bars: bounce }]).length === 0,
  "the same setup on the second day is older than one day",
);
assert(
  listMa4CrossStocks({ start: bounceTimes[40], end: day3 }, [{ code: "sh600001", name: "金叉", bars: bounce }]).length === 0,
  "the same setup on the third day is older than one day",
);
assert(
  listMa4CrossStocks({ start: bounceTimes[40], end: lastTime }, [{ code: "sh600001", name: "金叉", bars: bounce }]).length === 0,
  "a setup that has held past one day is dropped",
);

const beforeWindow = listMa4CrossStocks(
  { start: day2, end: day2 },
  [{ code: "sh600001", name: "金叉", bars: bounce }],
);
assert(beforeWindow.length === 0, "a cross that started before this trend is left out");

const stillUnder = datedBars(Array.from({ length: 46 }, () => 10));
assert(
  listMa4CrossStocks({ start: stillUnder[8].time, end: stillUnder[20].time }, [
    { code: "sh600002", name: "持平", bars: stillUnder },
  ]).length === 0,
  "a flat tape is not a stand-and-cross red-bar setup",
);

const falling = datedBars(
  Array.from({ length: 46 }, (_, i) => Number((20 - i * 0.12).toFixed(4))),
);
assert(
  listMa4CrossStocks({ start: falling[30].time, end: falling[45].time }, [
    { code: "sh600003", name: "下跌", bars: falling },
  ]).length === 0,
  "a decline without a 4/7 cross is not kept",
);
