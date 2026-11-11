import type { KBar } from "./types";

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
  weekOnMa4: boolean;
  weekOnMa7: boolean;
};

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

function closeOnMa4(closes: number[], index: number, spot = closes[index]): boolean {
  return closeOnMa(closes, 4, index, spot);
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

function weekStart(time: string): string {
  const [year, month, day] = time.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return time.slice(0, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** 每个交易日：日/周均线是否站上。周线用截至当天的未完成 K 线。 */
export function maStandFlags(bars: KBar[]): MaStandFlags[] {
  const dayCloses = bars.map((bar) => bar.close);
  const weekCloses: number[] = [];
  let weekKey = "";
  return bars.map((bar, index) => {
    const week = weekStart(bar.time);
    if (week !== weekKey) {
      weekCloses.push(bar.close);
      weekKey = week;
    } else {
      weekCloses[weekCloses.length - 1] = bar.close;
    }
    const w = weekCloses.length - 1;
    return {
      dayOnMa4: closeOnMa(dayCloses, 4, index),
      dayOnMa7: closeOnMa(dayCloses, 7, index),
      weekOnMa4: closeOnMa(weekCloses, 4, w),
      weekOnMa7: closeOnMa(weekCloses, 7, w),
    };
  });
}

function canStart(flags: MaStandFlags): boolean {
  return flags.dayOnMa4 && flags.dayOnMa7 && flags.weekOnMa4;
}

function bothDailyBroken(flags: MaStandFlags): boolean {
  return !flags.dayOnMa4 && !flags.dayOnMa7;
}

/** 最后一根是否还落在某段趋势区间里。收口的灰框不含跌破当天。 */
export function trendCoversLastBar(segments: SectorTrendSegment[], lastTime: string | undefined): boolean {
  if (!lastTime) return false;
  return segments.some((segment) => segment.status === "open" && segment.end === lastTime);
}

/**
 * 指数日 K 站上 MA4 和 MA7、周 K 站上 MA4，趋势开始。
 * 日 K 同时跌破 MA4 和 MA7，红色趋势结束，改成灰框，停在跌破前最后一根。不看周 K 的 MA7、月 K。
 */
export function captureSectorTrends(bars: KBar[], members: SectorMemberPath[] = []): SectorTrendSegment[] {
  if (bars.length < 7) return [];
  const flags = maStandFlags(bars);
  const segments: SectorTrendSegment[] = [];
  let start = -1;
  const push = (from: number, to: number, status: "open" | "closed") => {
    if (to < from || !(bars[from].close > 0) || !(bars[to].close > 0)) return;
    if (status === "closed" && to === from) return;
    const breadth = members.length ? segmentBreadth(bars, members, from === to && from > 0 ? from - 1 : from, to) : {
      upCount: 0,
      memberCount: 0,
      upRatio: 0,
      leaders: [] as TrendLeader[],
    };
    segments.push({
      start: bars[from].time,
      end: bars[to].time,
      gain: bars[to].close / bars[from].close - 1,
      status,
      upCount: breadth.upCount,
      memberCount: breadth.memberCount,
      upRatio: breadth.upRatio,
      leaders: breadth.leaders,
    });
  };
  for (let i = 0; i < bars.length; i += 1) {
    if (start < 0) {
      if (canStart(flags[i])) start = i;
      continue;
    }
    if (bothDailyBroken(flags[i])) {
      push(start, i - 1, "closed");
      start = -1;
    }
  }
  if (start >= 0) push(start, bars.length - 1, "open");
  return segments;
}

/**
 * 指数自己能不能把红框留到最后一根。只看日 K 均线和周 K MA4，不扫成分股。
 */
export function indexCouldBeOpen(bars: KBar[]): boolean {
  const last = bars.at(-1)?.time;
  return trendCoversLastBar(captureSectorTrends(bars), last);
}
