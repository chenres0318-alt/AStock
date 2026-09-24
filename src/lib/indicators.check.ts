import { analyzeBars, maAt, macdSeries, passesBuySetup } from "./indicators.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function almost(a: number, b: number, eps = 1e-6) {
  assert(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
}

function barsFrom(closes: number[], volumes: number[], last?: Partial<KBar>): KBar[] {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1];
    const isLast = i === closes.length - 1 && last;
    const open = isLast && last.open != null ? last.open : prev;
    const high = isLast && last.high != null ? last.high : Math.max(open, close) * 1.006;
    const low = isLast && last.low != null ? last.low : Math.min(open, close) * 0.994;
    return {
      time: new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: isLast && last.volume != null ? last.volume : volumes[i] ?? 1000,
    };
  });
}

function buildHarbinLike(opts?: {
  undercut?: boolean;
  weakYang?: boolean;
  climaxVol?: boolean;
  noDrop?: boolean;
}): KBar[] {
  const closes: number[] = [];
  const volumes: number[] = [];
  const lows: number[] = [];
  const highs: number[] = [];
  const opens: number[] = [];

  let price = 10;
  for (let i = 0; i < 42; i += 1) {
    price += 0.08;
    closes.push(Number(price.toFixed(3)));
    volumes.push(1000 + (i % 5) * 40);
    opens.push(price - 0.04);
    highs.push(price + 0.06);
    lows.push(price - 0.08);
  }

  const peak = price;
  const dropDays = opts?.noDrop ? 3 : 12;
  const floor = opts?.noDrop ? peak * 0.97 : peak * 0.78;
  for (let i = 0; i < dropDays; i += 1) {
    const t = (i + 1) / dropDays;
    price = peak + (floor - peak) * t;
    closes.push(Number(price.toFixed(3)));
    volumes.push(opts?.noDrop ? 1100 : 2800 + i * 180);
    opens.push(price + 0.08);
    highs.push(price + 0.12);
    lows.push(price - 0.15);
  }

  const swingLow = floor - 0.04;
  const bounce = [floor + 0.35, floor + 0.48];
  for (const value of bounce) {
    closes.push(Number(value.toFixed(3)));
    volumes.push(900);
    opens.push(value - 0.08);
    highs.push(value + 0.18);
    lows.push(value - 0.1);
  }

  const second = opts?.undercut ? swingLow * 0.96 : swingLow + 0.03;
  closes.push(Number(second.toFixed(3)));
  volumes.push(820);
  opens.push(second + 0.05);
  highs.push(second + 0.12);
  lows.push(second);
  closes.push(Number((second + 0.08).toFixed(3)));
  volumes.push(880);
  opens.push(second);
  highs.push(second + 0.16);
  lows.push(second + 0.02);

  closes.push(Number((second + 0.18).toFixed(3)));
  volumes.push(1100);
  opens.push(second + 0.1);
  highs.push(second + 0.22);
  lows.push(second + 0.06);

  const prev = closes[closes.length - 1];
  const lastClose = opts?.weakYang ? prev * 1.012 : prev * 1.102;
  const lastOpen = opts?.weakYang ? prev * 1.002 : prev * 1.008;
  closes.push(Number(lastClose.toFixed(3)));
  volumes.push(opts?.climaxVol ? 9000 : 2400);
  opens.push(lastOpen);
  highs.push(lastClose);
  lows.push(Math.min(lastOpen, prev) * 0.998);

  return closes.map((close, i) => ({
    time: new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10),
    open: Number(opens[i].toFixed(3)),
    high: Number(highs[i].toFixed(3)),
    low: Number(lows[i].toFixed(3)),
    close,
    volume: volumes[i],
  }));
}

const sma10 = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29];
almost(maAt(sma10, 10, 9)!, sma10.reduce((sum, value) => sum + value, 0) / 10);

assert(analyzeBars(Array.from({ length: 20 }, (_, i) => ({
  time: `t${i}`,
  open: 10,
  high: 10.2,
  low: 9.8,
  close: 10 + i,
  volume: 1000,
}))) == null, "short series should be rejected");

const rising = barsFrom(
  Array.from({ length: 70 }, (_, i) => 10 + i * 0.2),
  Array.from({ length: 70 }, () => 1200),
);
const up = analyzeBars(rising)!;
assert(up.aboveMa5, "rising close should sit above MA5");
assert(up.threeDayPct != null && up.threeDayPct > 0, "rising 3-day gain should be positive");
assert(!passesBuySetup(up), "steady uptrend should not pass the buy-point filter");

const falling = barsFrom(
  Array.from({ length: 80 }, (_, i) => 50 * Math.pow(0.99, i)),
  Array.from({ length: 80 }, () => 1500),
);
const down = analyzeBars(falling)!;
const macd = macdSeries(falling.map((bar) => bar.close)).at(-1)!;
almost(macd.hist, 2 * (macd.dif - macd.dea));
assert(down.aboveMa5 === false, "persistent decline should sit below MA5");
assert(!passesBuySetup(down), "pure downtrend should not pass buy-point filter");

const buy = analyzeBars(buildHarbinLike())!;
assert(buy.holdsFloor, "second probe should hold the swing low");
assert(buy.strongYang, "launch bar should be a big yang / limit-up");
assert(buy.reclaimMa5, "launch bar should reclaim MA5");
assert(buy.opensMas, "launch bar should open MA5/MA10");
assert(buy.macdTurning, "MACD histogram should turn up from green");
assert(buy.bottomShrinkVol, "bottom volume should shrink vs panic");
assert(buy.pullbackPct != null && buy.pullbackPct >= 8, "setup needs a prior sharp drop");
assert(passesBuySetup(buy), "Harbin / Youyan-like confirmation should pass");
assert(buy.threeDayPct != null && buy.threeDayPct > 5, "real buy may exceed old 3-day 5% cap");

const weak = analyzeBars(buildHarbinLike({ weakYang: true }))!;
assert(!weak.strongYang, "first stand without a big yang should not count as confirmation");
assert(!passesBuySetup(weak), "false first MA5 stand should fail");

const broken = analyzeBars(buildHarbinLike({ undercut: true }))!;
assert(!broken.holdsFloor, "second probe that breaks the low should fail");
assert(!passesBuySetup(broken), "broken swing low should not pass");

const chop = analyzeBars(buildHarbinLike({ noDrop: true }))!;
assert(!passesBuySetup(chop), "no sharp pullback should not pass");

console.log("indicators.check ok", {
  hist: buy.hist.toFixed(4),
  threeDayPct: buy.threeDayPct?.toFixed(2),
  pullbackPct: buy.pullbackPct?.toFixed(2),
  dayPct: buy.dayPct?.toFixed(2),
});
