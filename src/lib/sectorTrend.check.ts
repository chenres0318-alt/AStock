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
} from "./sectorTrend.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function tradingBars(closes: number[], start = "2024-01-01"): KBar[] {
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

const tooShort = tradingBars([100, 100, 100]);
assert(captureSectorTrends(tooShort).length === 0, "three days cannot make daily MA4>MA7");
assert(!indexCouldBeOpen(tooShort), "three days is not an open daily trend");
assert(!indexCouldBeOpen(tradingBars([100, 100, 100, 100])), "four days is not enough for daily MA7");
assert(!indexCouldBeOpen(tradingBars(Array.from({ length: 16 }, () => 100))), "flat days are not MA4>MA7");

const standing = tradingBars(Array.from({ length: 16 }, (_, i) => 100 + i));
const standingTrends = captureSectorTrends(standing);
assert(
  standingTrends.length === 1 && standingTrends[0].status === "open" && standingTrends[0].end === standing.at(-1)?.time,
  "sixteen rising days with MA4>MA7 stay an open red box",
);
assert(indexCouldBeOpen(standing), "daily MA4>MA7 looks open on price alone");
assert(openPriceTrend(standing)?.end === standing.at(-1)?.time, "price-only window covers the latest bar");
assert(trendCoversLastBar(standingTrends, standing.at(-1)?.time), "the open box covers the latest bar");
assert(captureSectorTrends(standing, []).length === 1, "drawing the daily box does not need constituents");
assert(
  !indexCouldBeOpen(tradingBars([10, 11, 12, 12, 12, 20, 20, 20, 16, 16, 16, 19])),
  "MA7>MA10 without MA4>MA7 does not start a red box",
);
assert(
  indexCouldBeOpen(tradingBars([18, 18, 18, 18, 10, 10, 10, 14, 15, 16, 17])),
  "MA4>MA7 still starts a red box when MA7 is not above MA10",
);

const pullbackAboveMa7 = tradingBars([...Array.from({ length: 16 }, (_, i) => 100 + i), 113]);
assert(indexCouldBeOpen(pullbackAboveMa7), "a dip under daily MA4 still keeps the box while the index is above MA7");

const crashed = tradingBars([...Array.from({ length: 16 }, (_, i) => 100 + i), 100]);
const crashedTrends = captureSectorTrends(crashed);
assert(crashedTrends.length === 1 && crashedTrends[0].status === "closed", "an index below daily MA7 closes the box");
assert(
  crashedTrends[0].end === standing.at(-1)?.time,
  "the gray box stops on the last day still at or above daily MA7",
);
assert(!indexCouldBeOpen(crashed), "an index below daily MA7 is no longer an open trend");
assert(!trendCoversLastBar(crashedTrends, crashed.at(-1)?.time), "a closed box does not cover the break day");

/** 日线 MA4 没有大于 MA7，不能开红框。 */
const ma4OnlyDay = tradingBars([120, 119, 118, 117, 116, 115, 114, 113, 112, 111, 110]);
assert(!captureSectorTrends(ma4OnlyDay).some((item) => item.status === "open"), "daily close on MA4 without MA4>MA7 does not start a red box");
assert(!indexCouldBeOpen(ma4OnlyDay), "an index without MA4>MA7 is not open");

const restarted = tradingBars([
  ...Array.from({ length: 16 }, (_, i) => 100 + i),
  90,
  90,
  ...Array.from({ length: 16 }, (_, i) => 110 + i),
]);
const restartedTrends = captureSectorTrends(restarted);
assert(
  restartedTrends.length === 2 &&
    restartedTrends[0].status === "closed" &&
    restartedTrends[1].status === "open",
  "after the index falls below daily MA7, MA4>MA7 again starts a new red box",
);

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

console.log("sectorTrend.check ok", {
  open: standingTrends[0].start,
  closedEnd: crashedTrends[0].end,
});
