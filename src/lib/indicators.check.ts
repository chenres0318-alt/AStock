import {
  analyzeCloses,
  maAt,
  macdSeries,
  passesBoardTech,
  passesStockTech,
  STOCK_THREE_DAY_CAP,
} from "./indicators.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function almost(a: number, b: number, eps = 1e-6) {
  assert(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
}

const sma10 = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29];
almost(maAt(sma10, 10, 9)!, sma10.reduce((sum, value) => sum + value, 0) / 10);

assert(analyzeCloses(Array.from({ length: 20 }, (_, i) => 10 + i)) == null, "short series should be rejected");

const rising = Array.from({ length: 60 }, (_, i) => 10 + i * 0.2);
const up = analyzeCloses(rising)!;
assert(up.aboveMa5, "rising close should sit above MA5");
assert(up.daysAboveMa5 > 3, "steady uptrend should have been above MA5 for more than 3 days");
assert(!up.firstStandMa5, "steady uptrend is not a first stand");
assert(!passesBoardTech(up), "extended uptrend should not pass first-stand board filter");

const falling = Array.from({ length: 80 }, (_, i) => 50 * Math.pow(0.99, i));
const down = analyzeCloses(falling)!;
const macd = macdSeries(falling).at(-1)!;
almost(macd.hist, 2 * (macd.dif - macd.dea));
assert(down.aboveMa5 === false, "persistent decline should sit below MA5");
assert(!passesBoardTech(down), "pure downtrend should not pass board filter");

function makeFirstStand(): number[] {
  const closes: number[] = [];
  for (let i = 0; i < 52; i += 1) {
    closes.push(Number((10 + 0.04 * Math.sin(i / 4)).toFixed(4)));
  }
  let price = closes[closes.length - 1];
  for (let i = 0; i < 6; i += 1) {
    price *= 0.991;
    closes.push(Number(price.toFixed(4)));
  }
  price *= 1.011;
  closes.push(Number(price.toFixed(4)));
  price *= 1.01;
  closes.push(Number(price.toFixed(4)));
  return closes;
}

const launch = analyzeCloses(makeFirstStand())!;
assert(launch.aboveMa5, "launch series should stand above MA5");
assert(launch.firstStandMa5, "launch series should be a recent first stand");
assert(launch.daysAboveMa5 >= 1 && launch.daysAboveMa5 <= 3, "first stand streak should be 1-3 days");
assert(launch.nearZeroAxis, "sideways launch should keep MACD near the 0 axis");
assert(launch.goldenCross || launch.deathCross, "MACD should be in golden or death cross");
assert(passesBoardTech(launch), "launch series should pass board rules");
assert(launch.threeDayPct != null && launch.threeDayPct <= STOCK_THREE_DAY_CAP, "launch 3-day gain should stay modest");
assert(passesStockTech(launch), "launch series should pass stock rules");

const hotCloses = makeFirstStand();
hotCloses[hotCloses.length - 1] = hotCloses[hotCloses.length - 4] * 1.08;
const hot = analyzeCloses(hotCloses)!;
if (hot.firstStandMa5 && hot.nearZeroAxis) {
  assert(hot.threeDayPct != null && hot.threeDayPct > STOCK_THREE_DAY_CAP, "hot last bar should exceed 5% 3-day gain");
  assert(!passesStockTech(hot), "stock rules should reject 3-day gain above 5%");
}

console.log("indicators.check ok", {
  daysAbove: launch.daysAboveMa5,
  golden: launch.goldenCross,
  death: launch.deathCross,
  hist: launch.hist.toFixed(4),
  threeDayPct: launch.threeDayPct?.toFixed(2),
});
