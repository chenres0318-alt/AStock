import { analyzeBars, maAt, macdSeries, passesScreen, screenReasons } from "./indicators.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function almost(a: number, b: number, eps = 1e-6) {
  assert(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
}

type LastOpts = {
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

function declineThen(last: LastOpts, days = 40, start = 20, step = 0.15): KBar[] {
  const bars: KBar[] = [];
  for (let i = 0; i < days; i += 1) {
    const close = Number((start - i * step).toFixed(3));
    const open = Number((close + 0.04).toFixed(3));
    bars.push({
      time: new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10),
      open,
      high: Number((open + 0.02).toFixed(3)),
      low: Number((close - 0.03).toFixed(3)),
      close,
      volume: 1000,
    });
  }
  const prev = bars[bars.length - 1];
  const close = last.close ?? Number((prev.close * 1.08).toFixed(3));
  const open = last.open ?? Number((prev.close * 1.005).toFixed(3));
  const high = last.high ?? Number((Math.max(open, close) * 1.01).toFixed(3));
  const low = last.low ?? Number((Math.min(open, close) * 0.995).toFixed(3));
  bars.push({
    time: new Date(Date.UTC(2025, 0, 2 + days)).toISOString().slice(0, 10),
    open,
    high,
    low,
    close,
    volume: last.volume ?? 2000,
  });
  return bars;
}

function risingBars(days = 50): KBar[] {
  return Array.from({ length: days }, (_, i) => {
    const close = Number((10 + i * 0.2).toFixed(3));
    const open = Number((close - 0.05).toFixed(3));
    const isLast = i === days - 1;
    return {
      time: new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10),
      open,
      high: Number((close * 1.006).toFixed(3)),
      low: Number((open * 0.997).toFixed(3)),
      close,
      volume: isLast ? 2400 : 1200,
    };
  });
}

const sma10 = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29];
almost(maAt(sma10, 10, 9)!, sma10.reduce((sum, value) => sum + value, 0) / 10);

assert(
  analyzeBars(
    Array.from({ length: 15 }, (_, i) => ({
      time: `t${i}`,
      open: 10,
      high: 10.2,
      low: 9.8,
      close: 10 + i,
      volume: 1000,
    })),
  ) == null,
  "short series should be rejected",
);

const hit = analyzeBars(declineThen({}))!;
assert(hit.priorMa5Down, "prior MA5 should mostly slope down");
assert(hit.priorBelowMa5, "prior closes should sit below MA5");
assert(hit.ma5TurnUp, "today MA5 should turn up");
assert(hit.aboveMa5, "today close should stand above MA5");
assert(hit.redBar, "today should be a yang bar");
assert(hit.volumeUp, "today volume should expand vs prior 5-day average");
assert(hit.amplitudePct != null && hit.amplitudePct >= 2, "today amplitude should be at least 2%");
assert(passesScreen(hit, 2.5), "full MA5 turn-up + volume setup should pass");
assert(passesScreen(hit, 2.49) === false, "turnover below 2.5% should fail");
assert(passesScreen(hit, null) === false, "missing turnover should fail");

const reasons = screenReasons(hit, 3.1);
assert(reasons.includes("五日线此前向下"), "reasons should mention prior MA5 down");
assert(reasons.includes("五日线拐头向上"), "reasons should mention MA5 turn-up");
assert(reasons.includes("此前股价在五日线下方"), "reasons should mention prior price below MA5");
assert(reasons.includes("收盘站上五日线"), "reasons should mention standing on MA5");
assert(reasons.includes("放量红柱"), "reasons should mention volume yang");
assert(reasons.includes("换手≥2.5%"), "reasons should mention turnover");
assert(reasons.includes("振幅≥2%"), "reasons should mention amplitude");

const rising = analyzeBars(risingBars())!;
assert(rising.aboveMa5, "rising close should sit above MA5");
assert(rising.priorMa5Down === false, "steady uptrend should not count as prior MA5 down");
assert(!passesScreen(rising, 3), "steady uptrend should not pass");

const falling = declineThen({ close: 13.9, open: 14.1, volume: 900 });
const down = analyzeBars(falling)!;
const macd = macdSeries(falling.map((bar) => bar.close)).at(-1)!;
almost(macd.hist, 2 * (macd.dif - macd.dea));
assert(down.ma5TurnUp === false, "continued decline should not turn MA5 up");
assert(down.aboveMa5 === false, "continued decline should stay below MA5");
assert(!passesScreen(down, 3), "pure downtrend should not pass");

const noTurn = analyzeBars(declineThen({ close: 14.5, open: 14.2, volume: 2000 }))!;
assert(noTurn.aboveMa5, "modest bounce can still close above MA5");
assert(noTurn.ma5TurnUp === false, "bounce below close[t-5] should not turn MA5 up");
assert(!passesScreen(noTurn, 3), "stand without MA5 turn-up should fail");

const yin = analyzeBars(declineThen({ open: 16.2, volume: 2000 }))!;
assert(yin.ma5TurnUp && yin.aboveMa5, "gapped yin can still reclaim MA5");
assert(yin.redBar === false, "close below open is not a red bar");
assert(!passesScreen(yin, 3), "yin bar should fail even with volume");

const dry = analyzeBars(declineThen({ volume: 1000 }))!;
assert(dry.redBar, "dry bounce can still be a yang");
assert(dry.volumeUp === false, "volume equal to prior average is not 放量");
assert(!passesScreen(dry, 3), "yang without volume expansion should fail");

const tight = analyzeBars(
  declineThen({
    high: 15.32,
    low: 15.28,
  }),
)!;
assert(tight.redBar && tight.volumeUp && tight.aboveMa5 && tight.ma5TurnUp, "tight range can still reclaim MA5");
assert(tight.amplitudePct != null && tight.amplitudePct < 2, "tight high-low should keep amplitude under 2%");
assert(!passesScreen(tight, 3), "amplitude below 2% should fail");

const alreadyTurned = declineThen({});
const first = alreadyTurned[alreadyTurned.length - 1];
alreadyTurned.push({
  time: "2025-03-01",
  open: first.close * 1.002,
  high: first.close * 1.04,
  low: first.close * 0.998,
  close: first.close * 1.03,
  volume: 2500,
});
const late = analyzeBars(alreadyTurned)!;
assert(late.ma5 > late.ma5Prev, "second up day can keep MA5 rising");
assert(late.ma5TurnUp === false, "turn-up must happen today, not as a follow-through");
assert(!passesScreen(late, 3), "already-turned MA5 should fail");

console.log("indicators.check ok", {
  ma5: hit.ma5.toFixed(3),
  ma5Prev: hit.ma5Prev.toFixed(3),
  amplitudePct: hit.amplitudePct?.toFixed(2),
  dayPct: hit.dayPct?.toFixed(2),
});
