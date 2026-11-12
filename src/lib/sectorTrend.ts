import type { KBar } from "./types";

/** 低点当天加上启动当天，两根就够。涨幅和成分股也过了，启动日收盘就画框。 */
const MIN_BARS = 2;
/** 从起点收盘到终点收盘，至少这段涨幅才算一段趋势。 */
const MIN_GAIN = 0.02;
/** 已经走完的灰框至少要有这么多根，才不像短脉冲。 */
const MIN_CLOSED_BARS = 5;
/** 已经走完的灰框至少要有这么多收盘涨幅，4% 上下的小波段丢掉。 */
const MIN_CLOSED_GAIN = 0.05;
/** 从高点回吐掉这段涨幅的四成，并且已经离开高点，视为这段走完。 */
const COMPLETE_GIVEBACK = 0.4;
/** 跌破起点、日收盘同时跌破 MA4 和 MA7，或者把这段涨幅回吐掉八成，收成灰框，终点留在高点。 */
const FAIL_GIVEBACK = 0.8;
const COMPLETE_LAG = 2;
/** 锤线之后还没确认成趋势，最多看到这么多根；再走不出来就放弃。 */
const LAUNCH_WAIT = 20;
/** 净涨幅 / 路径长度。横盘来回拉锯过不了。 */
const MIN_EFFICIENCY = 0.4;
const MIN_UP_RATIO = 0.5;
/** 领涨个股至少要比板块指数多出的涨幅。 */
const LEADER_GAP = 0.03;
const MIN_MEMBERS = 5;
/** 起点要比前两根的低点更低。最新一根也可以是当天打出的低点。 */
const LEFT_WING = 2;
/** 收盘落在当天振幅的上沿，才像从低点拉起来。 */
const CLOSE_FINISH = 0.6;

export type SectorMemberPath = {
  code: string;
  name: string;
  /** 交易日 → 收盘价。缺日期时用指数日历向前找最近一根。 */
  closes: Map<string, number>;
};

export type TrendLeader = {
  code: string;
  name: string;
  gain: number;
};

export type SectorTrendSegment = {
  start: string;
  end: string;
  gain: number;
  status: "open" | "closed";
  upCount: number;
  memberCount: number;
  upRatio: number;
  leaders: TrendLeader[];
};

export type MaStandFlags = {
  dayOnMa4: boolean;
  dayOnMa7: boolean;
  dayOnMa10: boolean;
  weekOnMa4: boolean;
  weekOnMa7: boolean;
  /** 周线 MA4 高于前一根。 */
  weekMa4Up: boolean;
  /** 周线已够算 MA4，才能谈跌破。 */
  weekMaReady: boolean;
  monthOnMa4: boolean;
  /** 月线 MA4 高于前一根。 */
  monthMa4Up: boolean;
  /** 日收盘跌破日线 MA4。 */
  dayBelowMa4: boolean;
  /** 周收盘跌破周线 MA4。 */
  weekBelowMa4: boolean;
};

type RawSegment = {
  start: number;
  end: number;
  /** 用来计算龙头和上涨家数的那一根。红框可能延伸到更新的一天。 */
  metricEnd: number;
  status: "open" | "closed";
};

function isPivotLow(bars: KBar[], index: number): boolean {
  if (index < LEFT_WING) return false;
  const low = bars[index].low;
  for (let j = index - LEFT_WING; j < index; j += 1) {
    if (bars[j].low < low) return false;
  }
  // 横着的一段低点取最右边那根。还没有下一根时，当天这个低点先算疑似启动。
  if (index + 1 < bars.length && bars[index + 1].low <= low) return false;
  return true;
}

/** 低点当天收在高位，并且当天收涨，从低点拉起或收盘涨幅已经够。 */
function priceReversal(bars: KBar[], index: number): boolean {
  if (index < 1) return false;
  const bar = bars[index];
  const prevClose = bars[index - 1].close;
  if (!(bar.low > 0) || !(prevClose > 0) || !(bar.high >= bar.low)) return false;
  const range = bar.high - bar.low;
  const finish = range > 0 ? (bar.close - bar.low) / range : 0;
  const rebound = bar.close / bar.low - 1;
  const dayGain = bar.close / prevClose - 1;
  return finish >= CLOSE_FINISH && dayGain > 0 && (rebound >= MIN_GAIN || dayGain >= MIN_GAIN);
}

function sameDayLaunch(
  bars: KBar[],
  members: SectorMemberPath[],
  index: number,
): { gain: number; breadth: ReturnType<typeof segmentBreadth> } | null {
  if (!priceReversal(bars, index) || !barOnMa4(bars, index)) return null;
  const dayGain = bars[index].close / bars[index - 1].close - 1;
  const breadth = segmentBreadth(bars, members, index - 1, index);
  const leader = breadth.leaders[0];
  if (breadth.memberCount < MIN_MEMBERS || breadth.upRatio < MIN_UP_RATIO) return null;
  if (!leader || leader.gain < dayGain + LEADER_GAP) return null;
  return { gain: dayGain, breadth };
}

function givebackRatio(bars: KBar[], start: number, peak: number, at: number, fromLow: boolean): number {
  const fromClose = bars[peak].close - bars[start].close;
  const advance = fromClose > 0 ? fromClose : fromLow ? bars[peak].close - bars[start].low : 0;
  if (!(advance > 0)) return 0;
  return Math.max(0, (bars[peak].close - bars[at].close) / advance);
}

function closeOn(closes: Map<string, number>, times: string[], index: number): number | null {
  for (let i = index; i >= Math.max(0, index - 4); i -= 1) {
    const value = closes.get(times[i]);
    if (value != null && value > 0) return value;
  }
  return null;
}

function segmentBreadth(bars: KBar[], members: SectorMemberPath[], start: number, end: number) {
  const times = bars.map((bar) => bar.time);
  const ranked: TrendLeader[] = [];
  let upCount = 0;
  let memberCount = 0;
  for (const member of members) {
    const from = closeOn(member.closes, times, start);
    const to = closeOn(member.closes, times, end);
    if (from == null || to == null) continue;
    const gain = to / from - 1;
    memberCount += 1;
    if (gain > 0) upCount += 1;
    ranked.push({ code: member.code, name: member.name, gain });
  }
  ranked.sort((a, b) => b.gain - a.gain);
  return {
    upCount,
    memberCount,
    upRatio: memberCount ? upCount / memberCount : 0,
    leaders: ranked.slice(0, 3),
    ranked,
  };
}

/** 一段趋势里每只成分股的区间涨幅，从高到低。 */
export function memberGainsInWindow(
  bars: KBar[],
  members: SectorMemberPath[],
  startTime: string,
  endTime: string,
): TrendLeader[] {
  const start = bars.findIndex((bar) => bar.time === startTime);
  const end = bars.findIndex((bar) => bar.time === endTime);
  if (start < 0 || end < start) return [];
  const from = start === end && start > 0 ? start - 1 : start;
  return segmentBreadth(bars, members, from, end).ranked;
}

function swingStats(bars: KBar[], start: number, end: number) {
  let path = 0;
  let maxHigh = bars[start].high;
  let minLow = bars[start].low;
  for (let i = start + 1; i <= end; i += 1) {
    path += Math.abs(bars[i].close - bars[i - 1].close);
    if (bars[i].high > maxHigh) maxHigh = bars[i].high;
    if (bars[i].low < minLow) minLow = bars[i].low;
  }
  const reversal = priceReversal(bars, start);
  const closeGain = bars[start].close > 0 ? bars[end].close / bars[start].close - 1 : 0;
  const base = reversal ? bars[start].low : bars[start].close;
  const wick = reversal ? Math.max(0, bars[start].close - bars[start].low) : 0;
  const lift = bars[end].close - base;
  const efficiency = path + wick > 0 ? lift / (path + wick) : 0;
  const amplitude = bars[start].close > 0 ? (maxHigh - minLow) / bars[start].close : 0;
  return { closeGain, efficiency, amplitude };
}

/** 收盘涨幅够，并且从低点拉起的路径够顺。锤线后先回一下再走，效率按低点算。启动当天指数还要站上 MA4。 */
function priceSwingQualifies(bars: KBar[], start: number, end: number): boolean {
  if (end - start + 1 < MIN_BARS || !(bars[start].close > 0) || !barOnMa4(bars, end)) return false;
  const stats = swingStats(bars, start, end);
  return stats.closeGain >= MIN_GAIN && stats.efficiency >= MIN_EFFICIENCY && stats.amplitude >= MIN_GAIN;
}

function qualifies(
  bars: KBar[],
  members: SectorMemberPath[],
  start: number,
  end: number,
): { gain: number; breadth: ReturnType<typeof segmentBreadth> } | null {
  if (!priceSwingQualifies(bars, start, end)) return null;
  const gain = bars[end].close / bars[start].close - 1;
  const breadth = segmentBreadth(bars, members, start, end);
  const leader = breadth.leaders[0];
  if (breadth.memberCount < MIN_MEMBERS || breadth.upRatio < MIN_UP_RATIO) return null;
  if (!leader || leader.gain < gain + LEADER_GAP) return null;
  return { gain, breadth };
}

/**
 * 从每个局部低点走到启动日。当天收在高位且指数站上 MA4 只算疑似启动，真正成段要等收盘涨幅和路径都够。
 * 还没成段时只看有没有跌破低点，锤线后的回吐不收口，好把 V 形波段连成一段。
 * 成段之后守着起点、涨幅也没回吐光：红框一直画到最新一根。
 * 之后跌破起点、日收盘同时跌破 MA4 和 MA7、或回吐八成：收成灰框，终点留在高点。还没成段就失败的脉冲不画框。
 */
function walkSegments(
  bars: KBar[],
  launchedAt: (index: number) => boolean,
  qualifiesAt: (start: number, end: number) => boolean,
): RawSegment[] {
  const found: RawSegment[] = [];
  const closes = bars.map((bar) => bar.close);
  let cursor = 0;
  for (let start = LEFT_WING; start < bars.length; start += 1) {
    if (start < cursor || !isPivotLow(bars, start)) continue;
    const floor = bars[start].low;
    const launched = launchedAt(start);
    let peak = start;
    let bornPeak = -1;
    let outcome: "open" | "closed" | "fail" | "pending" = "pending";
    let endAt = start;
    for (let j = start + 1; j < bars.length; j += 1) {
      if (bars[j].close >= bars[peak].close) peak = j;
      if (qualifiesAt(start, j)) bornPeak = peak;
      const giveback = givebackRatio(bars, start, peak, j, launched);
      const lostMas = bornPeak >= 0 && brokeDayMa4AndMa7(closes, j);
      const failed =
        bars[j].close < floor ||
        (bornPeak >= 0 && giveback >= FAIL_GIVEBACK) ||
        (bornPeak < 0 && j - start + 1 > LAUNCH_WAIT);
      if (failed) {
        if (bornPeak >= 0) {
          outcome = "closed";
          endAt = bornPeak;
        } else outcome = "fail";
        break;
      }
      if (lostMas || (bornPeak >= 0 && j >= peak + COMPLETE_LAG && giveback >= COMPLETE_GIVEBACK)) {
        outcome = "closed";
        endAt = peak;
        break;
      }
      endAt = j;
    }
    if (outcome === "pending") {
      if (bornPeak < 0) {
        if (launched && endAt === bars.length - 1 && bars[endAt].close >= floor) {
          outcome = "open";
          endAt = bars.length - 1;
          bornPeak = start;
        } else continue;
      } else {
        const giveback = givebackRatio(bars, start, peak, endAt, launched);
        if (endAt === bars.length - 1 && giveback < COMPLETE_GIVEBACK) {
          outcome = "open";
          endAt = bars.length - 1;
        } else {
          outcome = "closed";
          endAt = bornPeak;
        }
      }
    }
    if (outcome !== "open" && outcome !== "closed") continue;
    const stillQualified = endAt === start ? launched : qualifiesAt(start, endAt);
    const metricEnd = outcome === "open" && stillQualified ? endAt : bornPeak;
    if (metricEnd < start) continue;
    found.push({ start, end: endAt, metricEnd, status: outcome });
    cursor = endAt + 1;
  }
  return found;
}

export type MaCrossStock = {
  code: string;
  name: string;
  /** 这一轮连续站上 MA4 的第一天。 */
  time: string;
  /** 连续站上 MA4 的交易日数，越少越靠前。 */
  days: number;
};

function isGrowthBoardShare(code: string): boolean {
  const id = code.replace(/^[a-z]+/i, "").replace(/\D/g, "").slice(-6);
  return (
    id.startsWith("688") ||
    id.startsWith("689") ||
    id.startsWith("300") ||
    id.startsWith("301")
  );
}

function maAt(values: number[], period: number, index: number): number | null {
  if (index < period - 1 || index >= values.length) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += values[i];
  return sum / period;
}

function priceOnMa(spot: number, ma: number | null): boolean {
  if (ma == null || !(ma > 0) || !Number.isFinite(spot) || !(spot > 0)) return false;
  return Math.round(spot * 100) >= Math.round(ma * 100);
}

function alignedLivePrice(price: number | null | undefined, lastClose: number): number | null {
  if (price == null || !(price > 0)) return null;
  if (!(lastClose > 0)) return price;
  if (price > lastClose * 1.25) return null;
  return price;
}

function closeOnMa(closes: number[], period: number, index: number, spot = closes[index]): boolean {
  const ma = maAt(closes, period, index);
  return ma != null && ma > 0 && spot >= ma;
}

/** 收盘严格大于均线。 */
function closeAboveMa(closes: number[], period: number, index: number, spot = closes[index]): boolean {
  const ma = maAt(closes, period, index);
  return ma != null && ma > 0 && spot > ma;
}

/** 收盘严格小于均线。均线还没出来时不算跌破。 */
function closeBelowMa(closes: number[], period: number, index: number, spot = closes[index]): boolean {
  const ma = maAt(closes, period, index);
  return ma != null && ma > 0 && spot < ma;
}

/** 日收盘同时跌破 MA4 和 MA7。均线还没出来时不算。 */
function brokeDayMa4AndMa7(closes: number[], index: number): boolean {
  return closeBelowMa(closes, 4, index) && closeBelowMa(closes, 7, index);
}

function maRising(closes: number[], period: number, index: number): boolean {
  const cur = maAt(closes, period, index);
  const prev = maAt(closes, period, index - 1);
  return cur != null && prev != null && cur > prev;
}

function closeOnMa4(closes: number[], index: number, spot = closes[index]): boolean {
  return closeOnMa(closes, 4, index, spot);
}

/** 这一根收盘是否站上日线 MA4。均线还没出来时不算。 */
function barOnMa4(bars: KBar[], index: number): boolean {
  if (index < 3 || index >= bars.length) return false;
  return closeOnMa4(
    [bars[index - 3].close, bars[index - 2].close, bars[index - 1].close, bars[index].close],
    3,
  );
}

/** 指数或个股最新价是否站上 4 日均线。 */
export function standsOnMa4(bars: KBar[], price?: number | null): boolean {
  if (bars.length < 4) return false;
  const closes = bars.map((bar) => bar.close);
  const last = closes.length - 1;
  const spot = price != null && price > 0 ? price : closes[last];
  return closeOnMa4(closes, last, spot);
}

function listStandStocks(
  segment: { start: string; end: string },
  stocks: Array<{ code: string; name: string; bars: KBar[]; price?: number | null }>,
  periods: number[],
): MaCrossStock[] {
  const minIndex = Math.max(...periods) - 1;
  const rows: MaCrossStock[] = [];
  for (const stock of stocks) {
    if (isGrowthBoardShare(stock.code)) continue;
    const closes = stock.bars.map((bar) => bar.close);
    let last = -1;
    for (let i = 0; i < stock.bars.length; i += 1) {
      const time = stock.bars[i].time;
      if (time >= segment.start && time <= segment.end) last = i;
    }
    if (last < minIndex) continue;
    const spot = alignedLivePrice(stock.price, closes[last]) ?? closes[last];
    const onAll = (index: number, price = closes[index]) =>
      periods.every((period) => priceOnMa(price, maAt(closes, period, index)));
    if (!onAll(last, spot)) continue;
    let from = last;
    for (let i = last - 1; i >= minIndex; i -= 1) {
      if (!onAll(i)) break;
      from = i;
    }
    rows.push({
      code: stock.code,
      name: stock.name,
      time: stock.bars[from].time,
      days: last - from + 1,
    });
  }
  rows.sort((a, b) => {
    if (a.days !== b.days) return a.days - b.days;
    return a.name.localeCompare(b.name, "zh-CN");
  });
  return rows;
}

/**
 * 这段趋势最新一根上：现价站上 MA4 即可，按连续站上天数从少到多。
 * 不含科创板、创业板。没有站上的不进名单。
 */
export function listMa4CrossStocks(
  segment: { start: string; end: string },
  stocks: Array<{ code: string; name: string; bars: KBar[]; price?: number | null }>,
): MaCrossStock[] {
  return listStandStocks(segment, stocks, [4]);
}

/** 选股用：日 K 同时站上 MA4 和 MA7，按连续站上天数从少到多。不含科创、创业。 */
export function listMa4Ma7StandStocks(
  segment: { start: string; end: string },
  stocks: Array<{ code: string; name: string; bars: KBar[]; price?: number | null }>,
): MaCrossStock[] {
  return listStandStocks(segment, stocks, [4, 7]);
}

/** 选股用：日 K 同时站上 MA4、MA7、MA10，按连续站上天数从少到多。不含科创、创业。 */
export function listMa4Ma7Ma10StandStocks(
  segment: { start: string; end: string },
  stocks: Array<{ code: string; name: string; bars: KBar[]; price?: number | null }>,
): MaCrossStock[] {
  return listStandStocks(segment, stocks, [4, 7, 10]);
}

function weekStart(time: string): string {
  const [year, month, day] = time.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return time.slice(0, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** 每个交易日：日/周/月收盘是否大于 MA4，以及周/月 MA4 是否向上。周、月用截至当天的未完成 K 线。 */
export function maStandFlags(bars: KBar[]): MaStandFlags[] {
  const dayCloses = bars.map((bar) => bar.close);
  const weekCloses: number[] = [];
  const monthCloses: number[] = [];
  let weekKey = "";
  let monthKey = "";
  return bars.map((bar, index) => {
    const week = weekStart(bar.time);
    if (week !== weekKey) {
      weekCloses.push(bar.close);
      weekKey = week;
    } else {
      weekCloses[weekCloses.length - 1] = bar.close;
    }
    const month = bar.time.slice(0, 7);
    if (month !== monthKey) {
      monthCloses.push(bar.close);
      monthKey = month;
    } else {
      monthCloses[monthCloses.length - 1] = bar.close;
    }
    const w = weekCloses.length - 1;
    const m = monthCloses.length - 1;
    return {
      dayOnMa4: closeAboveMa(dayCloses, 4, index),
      dayOnMa7: closeOnMa(dayCloses, 7, index),
      dayOnMa10: closeOnMa(dayCloses, 10, index),
      weekOnMa4: closeAboveMa(weekCloses, 4, w),
      weekOnMa7: closeOnMa(weekCloses, 7, w),
      weekMa4Up: maRising(weekCloses, 4, w),
      weekMaReady: weekCloses.length >= 4,
      monthOnMa4: closeAboveMa(monthCloses, 4, m),
      monthMa4Up: maRising(monthCloses, 4, m),
      dayBelowMa4: closeBelowMa(dayCloses, 4, index),
      weekBelowMa4: closeBelowMa(weekCloses, 4, w),
    };
  });
}

function priceWindowCouldStayOpen(bars: KBar[], start: number): boolean {
  const floor = bars[start].low;
  if (!(bars[start].close > 0)) return false;
  const closes = bars.map((bar) => bar.close);
  let peak = start;
  const reversal = priceReversal(bars, start);
  let born = false;
  for (let j = start + 1; j < bars.length; j += 1) {
    if (bars[j].close < floor) return false;
    if (born === false && j - start + 1 > LAUNCH_WAIT) return false;
    if (bars[j].close >= bars[peak].close) peak = j;
    if (priceSwingQualifies(bars, start, j)) born = true;
    const giveback = givebackRatio(bars, start, peak, j, reversal);
    if (born && (giveback >= FAIL_GIVEBACK || brokeDayMa4AndMa7(closes, j))) return false;
    if (born && j >= peak + COMPLETE_LAG && giveback >= COMPLETE_GIVEBACK) return false;
  }
  if (!born) {
    const last = bars.length - 1;
    return reversal && bars[last].close >= floor && barOnMa4(bars, last);
  }
  if (start === bars.length - 1) return true;
  return givebackRatio(bars, start, peak, bars.length - 1, reversal) < COMPLETE_GIVEBACK;
}

/**
 * 指数自己还有没有可能把红框留到最后一根。
 * 只看价格：局部低点、没跌破起点、跨度够、曾经涨够且路径顺、回吐还没把这段收口，也还没同时跌破日 MA4 和 MA7。
 * 成分股同步和龙头要另外确认；这里放过的，完整计算里可能仍被否掉。
 */
export function indexCouldBeOpen(bars: KBar[]): boolean {
  return openPriceTrend(bars) != null;
}

/** 价格波段上仍开着的红框区间，不扫成分股。选股名单先用这一段。 */
export function openPriceTrend(bars: KBar[]): { start: string; end: string; status: "open" } | null {
  if (bars.length < LEFT_WING + 1) return null;
  const last = bars.length - 1;
  for (let start = LEFT_WING; start < bars.length; start += 1) {
    if (!isPivotLow(bars, start)) continue;
    if (priceWindowCouldStayOpen(bars, start)) {
      return { start: bars[start].time, end: bars[last].time, status: "open" };
    }
  }
  return null;
}

/** 最后一根是否还落在某段趋势区间里。收口的灰框终点在高点，不含后来的交易日。 */
export function trendCoversLastBar(segments: SectorTrendSegment[], lastTime: string | undefined): boolean {
  if (!lastTime) return false;
  return segments.some((segment) => segment.status === "open" && segment.end === lastTime);
}

/**
 * 同花顺近期趋势捕捉波段：从局部低点走到启动日。当天收在高位且指数站上 MA4 只算疑似启动；收盘涨幅和路径够了才成段。
 * 低点守住则延伸到最新一根；跌破低点、日收盘同时跌破 MA4 和 MA7、或回吐八成收成灰框，终点留在高点。
 * 还没成段就失败的脉冲、以及走完后太短太浅的小波段不画框。
 */
export function captureSectorTrends(bars: KBar[], members: SectorMemberPath[] = []): SectorTrendSegment[] {
  if (bars.length < LEFT_WING + 1 || members.length < MIN_MEMBERS) return [];
  const segments: SectorTrendSegment[] = [];
  for (const raw of walkSegments(
    bars,
    (index) => sameDayLaunch(bars, members, index) != null,
    (start, end) => qualifies(bars, members, start, end) != null,
  )) {
    const passed =
      raw.metricEnd === raw.start
        ? sameDayLaunch(bars, members, raw.start)
        : qualifies(bars, members, raw.start, raw.metricEnd);
    if (!passed || !(bars[raw.end].close > 0) || !(bars[raw.start].close > 0)) continue;
    const gain = raw.end === raw.start ? passed.gain : bars[raw.end].close / bars[raw.start].close - 1;
    const barCount = raw.end - raw.start + 1;
    if (raw.status === "closed" && (barCount < MIN_CLOSED_BARS || gain < MIN_CLOSED_GAIN)) continue;
    segments.push({
      start: bars[raw.start].time,
      end: bars[raw.end].time,
      gain,
      status: raw.status,
      upCount: passed.breadth.upCount,
      memberCount: passed.breadth.memberCount,
      upRatio: passed.breadth.upRatio,
      leaders: passed.breadth.leaders,
    });
  }
  return segments;
}
