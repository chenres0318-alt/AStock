import type { KBar, SectorItem } from "./types";

const INDUSTRY_ALIASES: Record<string, string[]> = {
  酿酒: ["白酒"],
  白酒: ["酿酒"],
  汽车行业: ["汽车零部件"],
};

export function matchIndustryBoard(industry: string, boards: SectorItem[]): SectorItem | null {
  const name = industry.trim();
  if (!name) return null;
  const stem = name.replace(/(行业|板块)$/g, "");
  const keys = stem && stem !== name ? [name, stem] : [name];
  for (const key of [...keys]) {
    for (const alias of INDUSTRY_ALIASES[key] ?? []) {
      if (!keys.includes(alias)) keys.push(alias);
    }
  }
  for (const key of keys) {
    const exact = boards.find((item) => item.name === key);
    if (exact) return exact;
  }
  for (const key of keys) {
    const fuzzy = boards.find((item) => key.includes(item.name) || item.name.includes(key));
    if (fuzzy) return fuzzy;
  }
  return null;
}

export type SectorMa4Cross = {
  code: string;
  name: string;
  days: number;
  time: string;
  /** 最新一根日线 MA4 上叉 MA7。 */
  ma4CrossUpMa7?: boolean;
  /** 周 K 收盘站上周线 MA4。 */
  weekOnMa4?: boolean;
  /** 周 K 收盘站上周线 MA7。 */
  weekOnMa7?: boolean;
  /** 月 K 收盘站上月线 MA4。 */
  monthOnMa4?: boolean;
  /** 周 K 连续站上 MA4 的周数。选股只要首周（上一周未站上）。 */
  weekDays?: number;
  /** 本周站上之前，连续没站上周线 MA4 的周数。 */
  weekGap?: number;
  /** 月 K 连续站上 MA4 的月数。 */
  monthDays?: number;
  /** 最新一根日线 MA4 在 MA7 上方。 */
  ma4OnMa7?: boolean;
  /** MA4 上叉 MA7 已持续的交易日数；未上叉为 0。 */
  crossDays?: number;
  /** 日 K 同时站上 MA4、MA7、MA10 的交易日数。 */
  holdDays?: number;
};

export type SectorMa4Member = {
  code: string;
  name: string;
  price: number | null;
  pct: number | null;
  turnover: number | null;
};

export type SectorMa4Screen = {
  code: string;
  name: string;
  onMa4: boolean;
  lastTime: string | undefined;
  openTrend: { start: string; end: string; status: "open" | "closed" } | null;
  /** 当前红框从开始到最新一根的交易日数。 */
  boxDays?: number;
  crosses: SectorMa4Cross[];
  members: SectorMa4Member[];
};

export type ScreenerBoardRef = {
  code: string;
  name: string;
  /** 该板块当前红框已持续的交易日数。 */
  days?: number;
};

export type Ma4StandHit = {
  code: string;
  name: string;
  /** 日 K 连续站上 MA4 的交易日数（含当天）。 */
  days: number;
  since: string;
  sector: string;
  sectorCode: string;
  /** 同时在红框里的行业和概念，行业在前。命中必须两种都有。 */
  boards: ScreenerBoardRef[];
  price: number | null;
  pct: number | null;
  turnover: number | null;
  ma4CrossUpMa7: boolean;
  weekOnMa4: boolean;
  weekOnMa7: boolean;
  monthOnMa4: boolean;
  weekDays: number;
  weekGap: number;
  monthDays: number;
  /** 最新一根日线 MA4 在 MA7 上方。 */
  ma4OnMa7: boolean;
  /** MA4 上叉 MA7 已持续的交易日数；未上叉为 0。 */
  crossDays: number;
  /** 日 K 同时站上 MA4、MA7、MA10 的交易日数。 */
  holdDays: number;
};

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

/** 现价明显高于前复权收盘时，多半是未复权行情，不能叠到均线上。 */
function alignedLivePrice(price: number | null | undefined, lastClose: number): number | null {
  if (price == null || !(price > 0)) return null;
  if (!(lastClose > 0)) return price;
  if (price > lastClose * 1.25) return null;
  return price;
}

function stockId(code: string): string {
  return code.replace(/^[a-z]+/i, "").replace(/\D/g, "").slice(-6);
}

/** 选股池：沪深主板，不含科创、创业、北交所、ST。 */
export function isScreenerShare(code: string, name = ""): boolean {
  const upper = name.toUpperCase();
  if (upper.includes("ST") || name.includes("退")) return false;
  const id = stockId(code);
  if (id.startsWith("688") || id.startsWith("689") || id.startsWith("300") || id.startsWith("301")) return false;
  const raw = code.trim().toLowerCase();
  if (raw.startsWith("bj") || raw.startsWith("2.")) return false;
  if (id.startsWith("92") || id.startsWith("8") || id.startsWith("4")) return false;
  return true;
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

function collapseBars(groups: Map<string, KBar[]>): KBar[] {
  const out: KBar[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const last = list[list.length - 1];
    out.push({
      time: last.time,
      open: first.open,
      high: Math.max(...list.map((item) => item.high)),
      low: Math.min(...list.map((item) => item.low)),
      close: last.close,
      volume: list.reduce((sum, item) => sum + item.volume, 0),
    });
  }
  return out;
}

/** 用日 K 拼周 K，当周未走完也算一根，收盘用最近一个交易日。 */
export function dailyToWeekly(bars: KBar[]): KBar[] {
  const groups = new Map<string, KBar[]>();
  for (const bar of bars) {
    const key = weekStart(bar.time);
    const list = groups.get(key);
    if (list) list.push(bar);
    else groups.set(key, [bar]);
  }
  return collapseBars(groups);
}

/** 用日 K 拼月 K，当月未走完也算一根，收盘用最近一个交易日。 */
export function dailyToMonthly(bars: KBar[]): KBar[] {
  const groups = new Map<string, KBar[]>();
  for (const bar of bars) {
    const key = bar.time.slice(0, 7);
    if (key.length < 7) continue;
    const list = groups.get(key);
    if (list) list.push(bar);
    else groups.set(key, [bar]);
  }
  return collapseBars(groups);
}

function closeOnMa(closes: number[], period: number, index: number, spot = closes[index]): boolean {
  return priceOnMa(spot, maAt(closes, period, index));
}

function closeOnMa4(closes: number[], index: number, spot = closes[index]): boolean {
  return closeOnMa(closes, 4, index, spot);
}

function consecutiveOnPeriods(closes: number[], periods: number[], spot?: number | null): number {
  const minIndex = Math.max(...periods) - 1;
  if (closes.length <= minIndex) return 0;
  const last = closes.length - 1;
  const lastSpot = alignedLivePrice(spot, closes[last]) ?? closes[last];
  const onAll = (index: number, price = closes[index]) =>
    periods.every((period) => closeOnMa(closes, period, index, price));
  if (!onAll(last, lastSpot)) return 0;
  let n = 1;
  for (let i = last - 1; i >= minIndex; i -= 1) {
    if (!onAll(i)) break;
    n += 1;
  }
  return n;
}

/** 从最新一根往前数，收盘连续站上 MA4 的根数。 */
export function consecutiveOnMa4(closes: number[], spot?: number | null): number {
  return consecutiveOnPeriods(closes, [4], spot);
}

/** 从最新一根往前数，收盘连续同时站上 MA4 和 MA7 的根数。 */
export function consecutiveOnMa4AndMa7(closes: number[], spot?: number | null): number {
  return consecutiveOnPeriods(closes, [4, 7], spot);
}

/** 从最新一根往前数，收盘连续同时站上 MA4、MA7、MA10 的根数。 */
export function consecutiveOnMa4AndMa7AndMa10(closes: number[], spot?: number | null): number {
  return consecutiveOnPeriods(closes, [4, 7, 10], spot);
}

function seriesWithSpot(closes: number[], index: number, spot?: number | null): number[] {
  if (index !== closes.length - 1) return closes;
  const last = alignedLivePrice(spot, closes[index]) ?? closes[index];
  if (last === closes[index]) return closes;
  const next = closes.slice();
  next[index] = last;
  return next;
}

function maRibbonParts(
  closes: number[],
  index: number,
  spot?: number | null,
): { onMa4: boolean; stacked: boolean; rising: boolean } | null {
  if (index < 10 || index >= closes.length) return null;
  const series = seriesWithSpot(closes, index, spot);
  const price = series[index];
  const ma4 = maAt(series, 4, index);
  const ma7 = maAt(series, 7, index);
  const ma10 = maAt(series, 10, index);
  const prev4 = maAt(closes, 4, index - 1);
  const prev7 = maAt(closes, 7, index - 1);
  const prev10 = maAt(closes, 10, index - 1);
  if (ma4 == null || ma7 == null || ma10 == null || prev4 == null || prev7 == null || prev10 == null) return null;
  return {
    onMa4: priceOnMa(price, ma4),
    stacked: ma4 > ma7 && ma7 > ma10,
    rising: ma4 > prev4 && ma7 > prev7 && ma10 > prev10,
  };
}

/** 收盘站上 MA4，且 MA4>MA7>MA10，三根均线都比上一根高。 */
export function maRibbonOk(closes: number[], index: number, spot?: number | null): boolean {
  const parts = maRibbonParts(closes, index, spot);
  return Boolean(parts?.onMa4 && parts.stacked && parts.rising);
}

/** 收盘站上 MA4，且 MA4、MA7、MA10 都比上一根高。不要求已经排成 MA4>MA7>MA10。 */
export function maRibbonTrendOk(closes: number[], index: number, spot?: number | null): boolean {
  const parts = maRibbonParts(closes, index, spot);
  return Boolean(parts?.onMa4 && parts.rising);
}

/**
 * 从最新一根往前数：当天须多头排列且向上，持续天数按「站上 MA4 且三线向上」连续成立的交易日。
 * 昨天已站上且三线向上、今天才排成 MA4>MA7>MA10，算 2 天。
 */
export function consecutiveMaRibbonDays(closes: number[], spot?: number | null): number {
  if (closes.length < 11) return 0;
  const last = closes.length - 1;
  if (!maRibbonOk(closes, last, spot)) return 0;
  let n = 1;
  for (let i = last - 1; i >= 10; i -= 1) {
    if (!maRibbonTrendOk(closes, i)) break;
    n += 1;
  }
  return n;
}

export type RibbonHit = {
  code: string;
  name: string;
  days: number;
  since: string;
  price: number | null;
  pct: number | null;
  turnover: number | null;
  sector: string;
  sectorCode: string;
  boards: ScreenerBoardRef[];
};

/** 周 K 现价对应的收盘呈 MA4>MA7>MA10 多头排列。 */
export function weekMaStacked(bars: KBar[], price?: number | null): boolean {
  const closes = dailyToWeekly(bars).map((bar) => bar.close);
  if (closes.length < 10) return false;
  const last = closes.length - 1;
  const series = seriesWithSpot(closes, last, price);
  const ma4 = maAt(series, 4, last);
  const ma7 = maAt(series, 7, last);
  const ma10 = maAt(series, 10, last);
  return ma4 != null && ma7 != null && ma10 != null && ma4 > ma7 && ma7 > ma10;
}

/**
 * 不看板块红框。股价站上 MA4，MA4>MA7>MA10，三根均线都比上一日高。
 * 周 K 须呈 MA4>MA7>MA10 排列。
 * 持续天数按股价站上 MA4 且三根均线都比上一日高的连续交易日数从短到长排。同一只股票只留一条。不含科创、创业、北交所、ST。
 */
export function collectRibbonHits(
  stocks: Array<{
    code: string;
    name: string;
    bars: KBar[];
    price?: number | null;
    pct?: number | null;
    turnover?: number | null;
    sector?: string;
    sectorCode?: string;
    boards?: ScreenerBoardRef[];
  }>,
): RibbonHit[] {
  const best = new Map<string, RibbonHit>();
  for (const stock of stocks) {
    if (!isScreenerShare(stock.code, stock.name)) continue;
    if (!weekMaStacked(stock.bars, stock.price)) continue;
    const closes = stock.bars.map((bar) => bar.close);
    const days = consecutiveMaRibbonDays(closes, stock.price);
    if (days < 1) continue;
    const since = stock.bars[stock.bars.length - days]?.time ?? "";
    const boards = ribbonHitBoards(stock);
    const primary = boards.find((item) => isIndustryBoard(item.code)) ?? boards[0] ?? { code: "", name: "" };
    const hit: RibbonHit = {
      code: stock.code,
      name: stock.name,
      days,
      since,
      price: stock.price ?? null,
      pct: stock.pct ?? null,
      turnover: stock.turnover ?? null,
      sector: primary.name,
      sectorCode: primary.code,
      boards,
    };
    const prev = best.get(hit.code);
    if (!prev) {
      best.set(hit.code, hit);
      continue;
    }
    const keep = hit.days < prev.days ? hit : prev;
    const merged = sortScreenerBoards([...prev.boards, ...hit.boards]);
    const home = merged.find((item) => isIndustryBoard(item.code)) ?? merged[0] ?? keep;
    best.set(hit.code, { ...keep, boards: merged, sector: home.name, sectorCode: home.code });
  }
  return [...best.values()].sort((a, b) => {
    if (a.days !== b.days) return a.days - b.days;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function periodStand(
  bars: KBar[],
  price?: number | null,
  periods: number[] = [4],
): { on: boolean; days: number; since: string } {
  const closes = bars.map((bar) => bar.close);
  const days = consecutiveOnPeriods(closes, periods, price);
  if (!days) return { on: false, days: 0, since: "" };
  return { on: true, days, since: bars[bars.length - days]?.time ?? "" };
}

function ma4AboveMa7(closes: number[], index: number): boolean {
  const ma4 = maAt(closes, 4, index);
  const ma7 = maAt(closes, 7, index);
  return ma4 != null && ma7 != null && ma4 > ma7;
}

/** 最新一根日线：前一日 MA4 还在 MA7 下方或持平，当日 MA4 站上 MA7。 */
export function ma4CrossedUpMa7(closes: number[], index = closes.length - 1): boolean {
  const ma4Prev = maAt(closes, 4, index - 1);
  const ma7Prev = maAt(closes, 7, index - 1);
  if (ma4Prev == null || ma7Prev == null) return false;
  return ma4Prev <= ma7Prev && ma4AboveMa7(closes, index);
}

/** MA4 持续在 MA7 上方的交易日数；未站上则为 0。 */
export function consecutiveMa4AboveMa7(closes: number[]): number {
  if (closes.length < 7) return 0;
  const last = closes.length - 1;
  if (!ma4AboveMa7(closes, last)) return 0;
  let n = 1;
  for (let i = last - 1; i >= 6; i -= 1) {
    if (!ma4AboveMa7(closes, i)) break;
    n += 1;
  }
  return n;
}

/** 本周收盘站上周线 MA4 之前，连续没站上的周数。还没有 MA4 的周不算空。 */
export function weeksOffMa4Before(closes: number[]): number {
  if (closes.length < 4) return 0;
  const last = closes.length - 1;
  if (!closeOnMa4(closes, last)) return 0;
  let n = 0;
  for (let i = last - 1; i >= 3; i -= 1) {
    if (closeOnMa4(closes, i)) break;
    n += 1;
  }
  return n;
}

/**
 * 当前这些条件同时成立的交易日数：取日 K / 周 K（可选月 K、上叉）里最晚开始的那段。
 * 没有日线时按各周期根数近似。
 */
export function conditionHoldDays(opts: {
  dailyDays: number;
  dailySince?: string;
  weekOn?: boolean;
  weekDays?: number;
  weekSince?: string;
  monthOn?: boolean;
  monthDays?: number;
  monthSince?: string;
  cross?: boolean;
  crossDays?: number;
  lastTime?: string;
  bars?: KBar[];
}): number {
  const starts: string[] = [];
  if (opts.dailySince) starts.push(opts.dailySince);
  if (opts.weekOn && opts.weekSince) starts.push(opts.weekSince);
  if (opts.monthOn && opts.monthSince) starts.push(opts.monthSince);
  if (opts.cross && opts.lastTime) {
    starts.push(opts.lastTime);
  } else if (opts.cross && opts.crossDays && opts.bars?.length) {
    const from = opts.bars.length - opts.crossDays;
    const time = opts.bars[Math.max(from, 0)]?.time;
    if (time) starts.push(time);
  }
  if (opts.bars?.length && starts.length) {
    const since = starts.reduce((a, b) => (a >= b ? a : b));
    return Math.max(
      opts.bars.filter((bar) => bar.time >= since).length,
      1,
    );
  }
  let n = Math.max(opts.dailyDays, 1);
  if (opts.weekOn && (opts.weekDays ?? 0) > 0) n = Math.min(n, (opts.weekDays ?? 0) * 5);
  if (opts.monthOn && (opts.monthDays ?? 0) > 0) n = Math.min(n, (opts.monthDays ?? 0) * 20);
  if (opts.cross) n = Math.min(n, Math.max(opts.crossDays ?? 1, 1));
  return Math.max(n, 1);
}

export function signalDurationLines(hit: {
  ma4CrossUpMa7?: boolean;
  crossDays?: number;
  weekOnMa4: boolean;
  weekOnMa7?: boolean;
  weekDays: number;
  monthOnMa4?: boolean;
  monthDays?: number;
  days: number;
}): string[] {
  return [`日${hit.days}日`];
}

export function weekStandsOnMa4(bars: KBar[], price?: number | null): boolean {
  return periodStand(dailyToWeekly(bars), price).on;
}

export function weekStandsOnMa4AndMa7(bars: KBar[], price?: number | null): boolean {
  return periodStand(dailyToWeekly(bars), price, [4, 7]).on;
}

export function monthStandsOnMa4(bars: KBar[], price?: number | null): boolean {
  return periodStand(dailyToMonthly(bars), price).on;
}

export function decorateMa4Crosses(
  crosses: SectorMa4Cross[],
  stocks: Array<{ code: string; bars: KBar[]; price?: number | null }>,
): SectorMa4Cross[] {
  const byCode = new Map(stocks.map((stock) => [stock.code, stock]));
  return crosses.map((cross) => {
    const stock = byCode.get(cross.code);
    if (!stock) {
      return {
        ...cross,
        ma4CrossUpMa7: false,
        weekOnMa4: false,
        weekOnMa7: false,
        monthOnMa4: false,
        weekDays: 0,
        weekGap: 0,
        monthDays: 0,
        ma4OnMa7: false,
        crossDays: 0,
        holdDays: cross.days,
      };
    }
    const closes = stock.bars.map((bar) => bar.close);
    const weekBars = dailyToWeekly(stock.bars);
    const weekMa4 = periodStand(weekBars, stock.price);
    const week = periodStand(weekBars, stock.price, [4, 7]);
    const month = periodStand(dailyToMonthly(stock.bars), stock.price);
    const weekCloses = weekBars.map((bar) => bar.close);
    const crossed = ma4CrossedUpMa7(closes);
    const crossDays = consecutiveMa4AboveMa7(closes);
    const ma4Days = consecutiveOnMa4(closes, stock.price) || cross.days;
    const allThreeDays = consecutiveOnMa4AndMa7AndMa10(closes, stock.price);
    const ma4Since = ma4Days && stock.bars.length >= ma4Days ? stock.bars[stock.bars.length - ma4Days]?.time : cross.time;
    return {
      ...cross,
      days: ma4Days,
      time: ma4Since || cross.time,
      ma4CrossUpMa7: crossed,
      ma4OnMa7: ma4AboveMa7(closes, closes.length - 1),
      weekOnMa4: weekMa4.on,
      weekOnMa7: week.on,
      monthOnMa4: month.on,
      weekDays: weekMa4.days,
      weekGap: weeksOffMa4Before(weekCloses),
      monthDays: month.days,
      crossDays,
      holdDays: allThreeDays,
    };
  });
}

function isIndustryBoard(code: string): boolean {
  return /^881\d{3}$/.test(code.trim());
}

function isConceptBoard(code: string): boolean {
  return /^88[5-9]\d{3}$/.test(code.trim());
}

function hasIndustryAndConcept(hit: Ma4StandHit): boolean {
  let industry = false;
  let concept = false;
  for (const board of hit.boards) {
    if (isIndustryBoard(board.code)) industry = true;
    else if (isConceptBoard(board.code)) concept = true;
  }
  return industry && concept;
}

/** 同时出现在红框行业和红框概念成分股里的主板代码。 */
export function dualBoxMemberIds(sectors: SectorMa4Screen[]): string[] {
  const industry = new Set<string>();
  const concept = new Set<string>();
  for (const sector of sectors) {
    const open = sector.openTrend;
    if (!open || open.status !== "open" || !sector.lastTime || open.end !== sector.lastTime) continue;
    const bucket = isIndustryBoard(sector.code) ? industry : isConceptBoard(sector.code) ? concept : null;
    if (!bucket) continue;
    for (const member of sector.members) {
      if (!isScreenerShare(member.code, member.name)) continue;
      bucket.add(stockId(member.code));
    }
  }
  return [...industry].filter((id) => concept.has(id));
}

function ribbonHitBoards(stock: {
  sector?: string;
  sectorCode?: string;
  boards?: ScreenerBoardRef[];
}): ScreenerBoardRef[] {
  const ordered = sortScreenerBoards(stock.boards ?? []);
  if (ordered.length) return ordered;
  const code = stock.sectorCode ?? "";
  const name = stock.sector ?? "";
  if (!code && !name) return [];
  return [{ code, name: name || code }];
}

function sortScreenerBoards(boards: ScreenerBoardRef[]): ScreenerBoardRef[] {
  const seen = new Set<string>();
  const unique: ScreenerBoardRef[] = [];
  for (const board of boards) {
    if (!board.code || seen.has(board.code)) continue;
    seen.add(board.code);
    unique.push(board);
  }
  return unique.sort((a, b) => {
    const byKind = Number(isIndustryBoard(b.code)) - Number(isIndustryBoard(a.code));
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function withBoards(hit: Ma4StandHit, boards: ScreenerBoardRef[]): Ma4StandHit {
  const ordered = sortScreenerBoards(boards);
  const primary = ordered.find((item) => isIndustryBoard(item.code)) ?? ordered[0] ?? { code: hit.sectorCode, name: hit.sector };
  return { ...hit, boards: ordered, sector: primary.name, sectorCode: primary.code };
}

/** 红框从 start 到 end 的天数；有 K 线时按交易日计。 */
export function trendBoxDays(start: string, end: string, bars?: Array<{ time: string }>): number {
  if (bars?.length) {
    const n = bars.filter((bar) => bar.time >= start && bar.time <= end).length;
    if (n > 0) return n;
  }
  const from = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 1;
  return Math.floor((to - from) / 86_400_000) + 1;
}

/** 行业红框和概念红框同时开着的天数：两边最长红框的重叠。 */
export function dualBoxDays(hit: { boards: ScreenerBoardRef[]; days?: number; holdDays?: number }): number {
  let industry = 0;
  let concept = 0;
  for (const board of hit.boards) {
    const n = board.days ?? 0;
    if (!(n > 0)) continue;
    if (isIndustryBoard(board.code)) industry = Math.max(industry, n);
    else if (isConceptBoard(board.code)) concept = Math.max(concept, n);
  }
  if (industry > 0 && concept > 0) return Math.min(industry, concept);
  return industry || concept || hit.holdDays || hit.days || 1;
}

function hitRank(hit: Ma4StandHit): number[] {
  return [hit.days];
}

function betterHit(next: Ma4StandHit, prev: Ma4StandHit | undefined): boolean {
  if (!prev) return true;
  const a = hitRank(next);
  const b = hitRank(prev);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return next.sector.localeCompare(prev.sector, "zh-CN") < 0;
}

/** 周 K 本周站上 MA4，且上周未站上（连续站上周数为 1）。 */
export function isFirstWeekOnMa4(hit: { weekOnMa4?: boolean; weekDays?: number }): boolean {
  return Boolean(hit.weekOnMa4) && (hit.weekDays ?? 0) === 1;
}

/**
 * 必须：个股日 K 站上 MA4；周 K 本周站上 MA4 且上周未站上（第一周）。
 * 所属行业和至少一个概念都要红框覆盖最新一根。只过行业或只过概念的不要。
 * 持续天数按日 K 站上 MA4 的天数从短到长排。同一只股票只留一条。不含科创、创业、北交所、ST。
 */
export function collectMa4StandHits(sectors: SectorMa4Screen[]): Ma4StandHit[] {
  const best = new Map<string, Ma4StandHit>();
  for (const sector of sectors) {
    const open = sector.openTrend;
    if (!open || open.status !== "open" || !sector.lastTime || open.end !== sector.lastTime) continue;
    const members = new Map(sector.members.map((item) => [item.code, item]));
    for (const cross of sector.crosses) {
      const member = members.get(cross.code);
      const name = cross.name || member?.name || cross.code;
      if (!isScreenerShare(cross.code, name)) continue;
      const ma4CrossUpMa7 = Boolean(cross.ma4CrossUpMa7);
      const weekOnMa4 = Boolean(cross.weekOnMa4);
      const weekOnMa7 = Boolean(cross.weekOnMa7);
      const monthOnMa4 = Boolean(cross.monthOnMa4);
      const weekDays = cross.weekDays ?? 0;
      const weekGap = cross.weekGap ?? 0;
      const monthDays = cross.monthDays ?? 0;
      const ma4OnMa7 = cross.ma4OnMa7 !== false;
      const crossDays = ma4CrossUpMa7 ? Math.max(cross.crossDays ?? 1, 1) : 0;
      const boxDays = sector.boxDays ?? trendBoxDays(open.start, open.end);
      const boardRef = { code: sector.code, name: sector.name, days: boxDays };
      const hit = withBoards(
        {
          code: cross.code,
          name,
          days: cross.days,
          since: cross.time,
          sector: sector.name,
          sectorCode: sector.code,
          boards: [boardRef],
          price: member?.price ?? null,
          pct: member?.pct ?? null,
          turnover: member?.turnover ?? null,
          ma4CrossUpMa7,
          weekOnMa4,
          weekOnMa7,
          monthOnMa4,
          weekDays,
          weekGap,
          monthDays,
          ma4OnMa7,
          crossDays,
          holdDays: cross.holdDays ?? cross.days,
        },
        [boardRef],
      );
      const prev = best.get(hit.code);
      if (!prev) {
        best.set(hit.code, hit);
        continue;
      }
      const merged = withBoards(betterHit(hit, prev) ? hit : prev, [...prev.boards, ...hit.boards]);
      best.set(hit.code, merged);
    }
  }
  return [...best.values()]
    .filter(hasIndustryAndConcept)
    .filter((hit) => hit.days >= 1 && isFirstWeekOnMa4(hit))
    .sort((a, b) => {
      const left = hitRank(a);
      const right = hitRank(b);
      for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return left[i] - right[i];
      }
      return a.name.localeCompare(b.name, "zh-CN");
    });
}
