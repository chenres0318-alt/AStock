import type { KBar } from "./types";

/** 低点当天加上启动当天，两根就够。涨幅和成分股也过了，启动日收盘就画框。 */
const MIN_BARS = 2;
/** 从起点收盘到终点收盘，至少这段涨幅才算一段趋势。 */
const MIN_GAIN = 0.02;
/** 从高点回吐掉这段涨幅的四成，并且已经离开高点，视为这段走完。 */
const COMPLETE_GIVEBACK = 0.4;
/** 跌破起点，或者把这段涨幅回吐掉八成，收成灰框，终点留在高点。 */
const FAIL_GIVEBACK = 0.8;
const COMPLETE_LAG = 2;
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
  if (!priceReversal(bars, index)) return null;
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

function qualifies(
  bars: KBar[],
  members: SectorMemberPath[],
  start: number,
  end: number,
): { gain: number; breadth: ReturnType<typeof segmentBreadth> } | null {
  const count = end - start + 1;
  if (count < MIN_BARS || !(bars[start].close > 0)) return null;
  let path = 0;
  let maxHigh = bars[start].high;
  let minLow = bars[start].low;
  for (let i = start + 1; i <= end; i += 1) {
    path += Math.abs(bars[i].close - bars[i - 1].close);
    if (bars[i].high > maxHigh) maxHigh = bars[i].high;
    if (bars[i].low < minLow) minLow = bars[i].low;
  }
  const gain = bars[end].close / bars[start].close - 1;
  const efficiency = path > 0 ? (bars[end].close - bars[start].close) / path : 0;
  const amplitude = (maxHigh - minLow) / bars[start].close;
  if (gain < MIN_GAIN || efficiency < MIN_EFFICIENCY || amplitude < MIN_GAIN) return null;
  const breadth = segmentBreadth(bars, members, start, end);
  const leader = breadth.leaders[0];
  if (breadth.memberCount < MIN_MEMBERS || breadth.upRatio < MIN_UP_RATIO) return null;
  if (!leader || leader.gain < gain + LEADER_GAP) return null;
  return { gain, breadth };
}

/**
 * 从每个局部低点走到启动日。涨幅、成分股、龙头第一次一起满足，当天就留下框。
 * 还守着起点、涨幅也没回吐光：红框一直画到最新一根。
 * 之后跌破起点或回吐八成：不把这段擦掉，收成灰框，终点留在仍然符合条件的高点。
 * 还没满足条件就失败的脉冲，不画框。
 */
function walkSegments(bars: KBar[], members: SectorMemberPath[]): RawSegment[] {
  const found: RawSegment[] = [];
  let cursor = 0;
  for (let start = LEFT_WING; start < bars.length; start += 1) {
    if (start < cursor || !isPivotLow(bars, start)) continue;
    const floor = bars[start].low;
    const launched = sameDayLaunch(bars, members, start);
    let peak = start;
    let bornPeak = launched ? start : -1;
    let outcome: "open" | "closed" | "fail" | "pending" = "pending";
    let endAt = start;
    for (let j = start + 1; j < bars.length; j += 1) {
      if (bars[j].close >= bars[peak].close) peak = j;
      if (qualifies(bars, members, start, j)) bornPeak = peak;
      const giveback = givebackRatio(bars, start, peak, j, launched != null);
      const failed = bars[j].close < floor || giveback >= FAIL_GIVEBACK;
      if (failed) {
        if (bornPeak >= 0) {
          outcome = "closed";
          endAt = bornPeak;
        } else outcome = "fail";
        break;
      }
      if (bornPeak >= 0 && j >= peak + COMPLETE_LAG && giveback >= COMPLETE_GIVEBACK) {
        outcome = "closed";
        endAt = peak;
        break;
      }
      endAt = j;
    }
    if (outcome === "pending") {
      if (bornPeak < 0) continue;
      const giveback = givebackRatio(bars, start, peak, endAt, launched != null);
      if (endAt === bars.length - 1 && giveback < COMPLETE_GIVEBACK) {
        outcome = "open";
        endAt = bars.length - 1;
      } else {
        outcome = "closed";
        endAt = bornPeak;
      }
    }
    if (outcome !== "open" && outcome !== "closed") continue;
    const stillQualified = endAt === start ? launched != null : qualifies(bars, members, start, endAt) != null;
    const metricEnd = outcome === "open" && stillQualified ? endAt : bornPeak;
    if (metricEnd < start) continue;
    found.push({ start, end: endAt, metricEnd, status: outcome });
    cursor = endAt + 1;
  }
  return found;
}

/**
 * 指数自己还有没有可能把红框留到最后一根。
 * 只看价格：局部低点、没跌破起点、跨度够、曾经涨够且路径顺、回吐还没把这段收口。
 * 成分股同步和龙头要另外确认；这里放过的，完整计算里可能仍被否掉。
 */
export function indexCouldBeOpen(bars: KBar[]): boolean {
  if (bars.length < LEFT_WING + 1) return false;
  for (let start = LEFT_WING; start < bars.length; start += 1) {
    if (!isPivotLow(bars, start)) continue;
    if (priceWindowCouldStayOpen(bars, start)) return true;
  }
  return false;
}

function priceWindowCouldStayOpen(bars: KBar[], start: number): boolean {
  const floor = bars[start].low;
  const startClose = bars[start].close;
  if (!(startClose > 0)) return false;
  let peak = start;
  let path = 0;
  let maxHigh = bars[start].high;
  let minLow = bars[start].low;
  const reversal = priceReversal(bars, start);
  let born = reversal;
  for (let j = start + 1; j < bars.length; j += 1) {
    if (bars[j].close < floor) return false;
    path += Math.abs(bars[j].close - bars[j - 1].close);
    if (bars[j].high > maxHigh) maxHigh = bars[j].high;
    if (bars[j].low < minLow) minLow = bars[j].low;
    if (bars[j].close >= bars[peak].close) peak = j;
    const gain = bars[j].close / startClose - 1;
    const efficiency = path > 0 ? (bars[j].close - startClose) / path : 0;
    const amplitude = (maxHigh - minLow) / startClose;
    if (
      !born &&
      j - start + 1 >= MIN_BARS &&
      gain >= MIN_GAIN &&
      efficiency >= MIN_EFFICIENCY &&
      amplitude >= MIN_GAIN
    ) {
      born = true;
    }
    const giveback = givebackRatio(bars, start, peak, j, reversal);
    if (giveback >= FAIL_GIVEBACK) return false;
    if (born && j >= peak + COMPLETE_LAG && giveback >= COMPLETE_GIVEBACK) return false;
  }
  if (!born) return false;
  if (start === bars.length - 1) return true;
  return givebackRatio(bars, start, peak, bars.length - 1, reversal) < COMPLETE_GIVEBACK;
}

/** 最后一根是否还落在某段趋势区间里。收口的灰框终点在高点，不含后来的交易日。 */
export function trendCoversLastBar(segments: SectorTrendSegment[], lastTime: string | undefined): boolean {
  if (!lastTime) return false;
  return segments.some((segment) => segment.status === "open" && segment.end === lastTime);
}

/** 板块指数上的一段上涨。价格、时间、个股同步、波动率四条一起过才留下。 */
export function captureSectorTrends(bars: KBar[], members: SectorMemberPath[]): SectorTrendSegment[] {
  if (bars.length < LEFT_WING + 1 || members.length < MIN_MEMBERS) return [];
  const segments: SectorTrendSegment[] = [];
  for (const raw of walkSegments(bars, members)) {
    const passed =
      raw.metricEnd === raw.start
        ? sameDayLaunch(bars, members, raw.start)
        : qualifies(bars, members, raw.start, raw.metricEnd);
    if (!passed || !(bars[raw.end].close > 0) || !(bars[raw.start].close > 0)) continue;
    segments.push({
      start: bars[raw.start].time,
      end: bars[raw.end].time,
      gain: raw.end === raw.start ? passed.gain : bars[raw.end].close / bars[raw.start].close - 1,
      status: raw.status,
      upCount: passed.breadth.upCount,
      memberCount: passed.breadth.memberCount,
      upRatio: passed.breadth.upRatio,
      leaders: passed.breadth.leaders,
    });
  }
  return segments;
}
