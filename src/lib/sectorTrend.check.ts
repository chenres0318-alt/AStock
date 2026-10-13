import { captureSectorTrends, indexCouldBeOpen, trendCoversLastBar, type SectorMemberPath } from "./sectorTrend.ts";
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

console.log("sectorTrend.check ok", {
  open: heldTrends[0].gain,
  closed: finishedTrends[0].gain,
});
