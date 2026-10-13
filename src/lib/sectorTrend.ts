import type { KBar } from "./types";

/** 少于 4 个交易日的上涨只当单日脉冲，不画框。 */
const MIN_BARS = 4;
/** 从起点收盘到终点收盘，至少这段涨幅才算一段趋势。 */
const MIN_GAIN = 0.02;
/** 从高点回吐掉这段涨幅的四成，并且已经离开高点，视为这段走完。 */
const COMPLETE_GIVEBACK = 0.4;
/** 涨幅几乎回吐光，或者还在试的时候快速跌破，红框删掉。 */
const FAIL_GIVEBACK = 0.8;
const COMPLETE_LAG = 2;
/** 净涨幅 / 路径长度。横盘来回拉锯过不了。 */
const MIN_EFFICIENCY = 0.4;
const MIN_UP_RATIO = 0.5;
/** 领涨个股至少要比板块指数多出的涨幅。 */
const LEADER_GAP = 0.03;
const MIN_MEMBERS = 5;
const PIVOT_WING = 2;

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
  status: "open" | "closed";
};

function isPivotLow(bars: KBar[], index: number): boolean {
  if (index < PIVOT_WING || index + PIVOT_WING >= bars.length) return false;
  const low = bars[index].low;
  for (let j = index - PIVOT_WING; j <= index + PIVOT_WING; j += 1) {
    if (j !== index && bars[j].low < low) return false;
  }
  return true;
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
  return segmentBreadth(bars, members, start, end).ranked;
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
 * 从每个局部低点向前走。
 * 收盘跌破起点低点，或涨幅回吐八成，这段试探失败，不留框。
 * 离开高点两个交易日、并且回吐四成但没破位，这段收口，终点定在高点。
 * 走到最后一根仍守住涨幅，就是还在试的红框。
 */
function walkSegments(bars: KBar[]): RawSegment[] {
  const found: RawSegment[] = [];
  let cursor = 0;
  for (let start = PIVOT_WING; start < bars.length - PIVOT_WING; start += 1) {
    if (start < cursor || !isPivotLow(bars, start)) continue;
    const floor = bars[start].low;
    let peak = start;
    let outcome: "open" | "closed" | "fail" | "pending" = "pending";
    let endAt = start;
    for (let j = start + 1; j < bars.length; j += 1) {
      if (bars[j].close < floor) {
        outcome = "fail";
        break;
      }
      if (bars[j].close >= bars[peak].close) peak = j;
      const advance = bars[peak].close - bars[start].close;
      const giveback = advance > 0 ? (bars[peak].close - bars[j].close) / advance : 0;
      if (giveback >= FAIL_GIVEBACK) {
        outcome = "fail";
        break;
      }
      if (peak > start && j >= peak + COMPLETE_LAG && giveback >= COMPLETE_GIVEBACK) {
        outcome = "closed";
        endAt = peak;
        break;
      }
      endAt = j;
    }
    if (outcome === "pending") {
      const advance = bars[peak].close - bars[start].close;
      const giveback = advance > 0 ? (bars[peak].close - bars[endAt].close) / advance : 0;
      if (endAt === bars.length - 1 && giveback < COMPLETE_GIVEBACK) outcome = "open";
      else if (peak > start && giveback >= COMPLETE_GIVEBACK) {
        outcome = "closed";
        endAt = peak;
      } else outcome = "fail";
    }
    if (outcome !== "open" && outcome !== "closed") continue;
    found.push({ start, end: endAt, status: outcome });
    cursor = endAt + 1;
  }
  return found;
}

/** 板块指数上的一段上涨。价格、时间、个股同步、波动率四条一起过才留下。 */
export function captureSectorTrends(bars: KBar[], members: SectorMemberPath[]): SectorTrendSegment[] {
  if (bars.length < MIN_BARS + PIVOT_WING * 2 || members.length < MIN_MEMBERS) return [];
  const segments: SectorTrendSegment[] = [];
  for (const raw of walkSegments(bars)) {
    const passed = qualifies(bars, members, raw.start, raw.end);
    if (!passed) continue;
    segments.push({
      start: bars[raw.start].time,
      end: bars[raw.end].time,
      gain: passed.gain,
      status: raw.status,
      upCount: passed.breadth.upCount,
      memberCount: passed.breadth.memberCount,
      upRatio: passed.breadth.upRatio,
      leaders: passed.breadth.leaders,
    });
  }
  return segments;
}
