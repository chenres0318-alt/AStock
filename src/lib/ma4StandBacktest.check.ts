import {
  annualizedReturn,
  calendarYears,
  lotsFor,
  runMa4StandBacktest,
} from "./ma4StandBacktest.ts";
import type { KBar } from "./types.ts";
import type { SectorTrendSegment } from "./sectorTrend.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function kbars(closes: number[], start = "2020-01-02"): KBar[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return closes.map((close, i) => {
    const time = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    const prev = i === 0 ? close : closes[i - 1];
    return {
      time,
      open: prev,
      high: Math.max(prev, close) * 1.01,
      low: Math.min(prev, close) * 0.99,
      close,
      volume: 1000,
    };
  });
}

const segment = (start: string, end: string): SectorTrendSegment => ({
  start,
  end,
  gain: 0.05,
  status: "closed",
  upCount: 5,
  memberCount: 6,
  upRatio: 0.8,
  leaders: [],
});

assert(Math.abs(calendarYears("2020-01-01", "2023-06-01") - 3.4141) < 0.0001, "window A is 3.4141 years");
assert(Math.abs(calendarYears("2023-10-25", "2026-10-25") - 3.0007) < 0.0001, "window B is 3.0007 years");
assert(Math.abs(annualizedReturn(36.98976, 3.4141) - 1.9019) < 0.0001, "A CAGR of +3698.98% over 3.4141y is ~190.19%");
assert(Math.abs(annualizedReturn(13.42828, 3.0007) - 1.4340) < 0.0001, "B CAGR of +1342.83% over 3.0007y is ~143.40%");
assert(annualizedReturn(-0.5, 0) === 0, "zero-length windows have no CAGR");

assert(lotsFor(20_000, 10) === 2000, "20k at 10 yuan is 2000 shares");
assert(lotsFor(20_000, 210) === 0, "a name above 200 yuan cannot fill one 20k lot");
assert(lotsFor(20_000, 15.3) === 1300, "lots round down to 100 shares");

const index = kbars([
  10, 10.2, 10.4, 10.6, 10.8, 11, 11.2, 11.4, 11.6, 11.8, 12, 12.2, 12.4, 12.6, 12.8, 13, 13.2, 13.4, 13.6, 13.8,
]);
const shortStand = kbars([
  8, 8.1, 8.2, 7.0, 8.5, 8.7, 8.9, 9.1, 9.3, 9.5, 9.7, 9.9, 10.1, 10.3, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5,
]);
const longStand = kbars([
  20, 20.2, 20.4, 20.6, 20.8, 21, 21.2, 21.4, 21.6, 21.8, 22, 22.2, 22.4, 22.6, 22.8, 23, 23.2, 23.4, 23.6, 23.8,
]);

const box = segment(index[4].time, index[16].time);
const result = runMa4StandBacktest({
  label: "unit",
  indexBars: index,
  stocks: [
    { code: "sh600001", name: "短站", bars: shortStand },
    { code: "sh600002", name: "长站", bars: longStand },
  ],
  periodStart: index[0].time,
  periodEnd: index[index.length - 1].time,
  segments: [box],
});

assert(result.trades.length === 1, `expected one trade, got ${result.trades.length}`);
assert(result.trades[0].name === "短站", "the shortest MA4 stand is bought");
assert(result.trades[0].entry === index[4].time, "entry is the first day of the red box");
assert(result.trades[0].reason === "stock-ma4", `exit should be stock MA4, got ${result.trades[0].reason}`);
assert(result.trades[0].exit === index[14].time, `stock break should exit on the close below MA4 (${result.trades[0].exit})`);
assert(result.returnPct !== 0, "the losing MA4 break should move total capital");
assert(result.maxDrawdownPct > 0, "a losing trade from the peak creates drawdown");
assert(result.calendarYears > 0, "the injected window has a positive calendar span");
assert(
  Math.abs(result.annualizedReturn - annualizedReturn(result.returnPct, result.calendarYears)) < 1e-12,
  "annualizedReturn matches (1+r)^(1/y)-1",
);

const belowMa4Index = kbars([12, 11, 10, 9, 8, 7.5, 7.2, 7, 6.8, 6.5, 6.3, 6.1, 6, 5.9, 5.8, 5.7]);
const skip = runMa4StandBacktest({
  label: "skip",
  indexBars: belowMa4Index,
  stocks: [{ code: "sh600001", name: "短站", bars: belowMa4Index }],
  periodStart: belowMa4Index[0].time,
  periodEnd: belowMa4Index[belowMa4Index.length - 1].time,
  segments: [segment(belowMa4Index[4].time, belowMa4Index[10].time)],
});
assert(skip.trades.length === 0, "a box whose first day is below index MA4 is skipped");
assert(skip.skippedNoMa4 >= 1, "that skip is counted as index not on MA4");

const waitIndex = kbars([8, 7.5, 7.2, 7, 6.8, 8.5, 8.7, 8.9, 9.1, 9.3, 9.5, 9.7, 9.9, 10.1, 10.3, 10.5]);
const waitStock = kbars([8, 7.5, 7.2, 7, 6.8, 8.5, 8.7, 8.9, 9.1, 9.3, 9.5, 9.7, 9.9, 8.0, 8.1, 8.2]);
const waited = runMa4StandBacktest({
  label: "wait",
  indexBars: waitIndex,
  stocks: [{ code: "sh600001", name: "短站", bars: waitStock }],
  periodStart: waitIndex[0].time,
  periodEnd: waitIndex[waitIndex.length - 1].time,
  entryMode: "first-on-ma4",
  segments: [segment(waitIndex[4].time, waitIndex[12].time)],
});
assert(waited.trades.length === 1, "first-on-ma4 waits inside the box");
assert(waited.trades[0].entry === waitIndex[5].time, "entry is the first later day the index stands on MA4");

const twoBoxes = runMa4StandBacktest({
  label: "two",
  indexBars: index,
  stocks: [
    { code: "sh600001", name: "短站", bars: shortStand },
    { code: "sh600002", name: "长站", bars: longStand },
  ],
  periodStart: index[0].time,
  periodEnd: index[index.length - 1].time,
  segments: [box, segment(index[16].time, index[18].time)],
});
assert(twoBoxes.boxes === 2, "two injected boxes are both in the window");

const reentered = runMa4StandBacktest({
  label: "reenter",
  indexBars: index,
  stocks: [
    { code: "sh600001", name: "短站", bars: shortStand },
    { code: "sh600002", name: "长站", bars: longStand },
  ],
  periodStart: index[0].time,
  periodEnd: index[index.length - 1].time,
  capital: 100_000,
  allCash: true,
  sameDayReentry: true,
  entryMode: "in-box-on-ma4",
  segments: [box],
});
assert(reentered.trades.length >= 2, `in-box-on-ma4 should re-enter after a stock MA4 break, got ${reentered.trades.length}`);
assert(reentered.trades[0].name === "短站", "the first fill is still the shortest stand");
assert(reentered.trades[1].entry === index[14].time, "same-day re-entry is the close the first name drops MA4");
assert(reentered.trades[1].name === "长站", "after the short name breaks, the remaining MA4 name is bought");
assert(reentered.trades[1].code !== reentered.trades[0].code, "same-day rebuy must be a different name");
assert(
  reentered.trades[0].shares * reentered.trades[0].entryPrice > 90_000,
  "all-cash 10w deploys most of the book",
);
for (let i = 1; i < reentered.trades.length; i += 1) {
  const prev = reentered.trades[i - 1];
  const cur = reentered.trades[i];
  assert(cur.entry >= prev.exit, "the book never holds two names at once");
  if (cur.entry === prev.exit) {
    assert(cur.code !== prev.code, "same-day rebuy skips the name that just left");
  }
}

const once = runMa4StandBacktest({
  label: "once",
  indexBars: index,
  stocks: [
    { code: "sh600001", name: "短站", bars: shortStand },
    { code: "sh600002", name: "长站", bars: longStand },
  ],
  periodStart: index[0].time,
  periodEnd: index[index.length - 1].time,
  entryMode: "first-on-ma4",
  segments: [box],
});
assert(once.trades.length === 1, "first-on-ma4 still enters a box only once");

const nextDay = runMa4StandBacktest({
  label: "nextday",
  indexBars: index,
  stocks: [
    { code: "sh600001", name: "短站", bars: shortStand },
    { code: "sh600002", name: "长站", bars: longStand },
  ],
  periodStart: index[0].time,
  periodEnd: index[index.length - 1].time,
  capital: 100_000,
  allCash: true,
  entryMode: "in-box-on-ma4",
  segments: [box],
});
assert(nextDay.trades.length >= 2, `after an exit the next buy waits a bar, got ${nextDay.trades.length}`);
assert(nextDay.trades[0].exit === index[14].time, "the first name still leaves on the MA4 break");
assert(nextDay.trades[1].entry === index[15].time, "the next buy is the following session, not the exit close");
assert(
  nextDay.trades.every((trade) => trade.entry !== trade.exit || trade.pnl === 0),
  "a held name must leave before the book buys again",
);
for (let i = 1; i < nextDay.trades.length; i += 1) {
  assert(nextDay.trades[i].entry > nextDay.trades[i - 1].exit, "the next buy is after the previous exit");
}

console.log("ma4StandBacktest checks passed");
