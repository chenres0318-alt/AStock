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
  /** 周 K 连续同时站上 MA4 和 MA7 的周数。 */
  weekDays?: number;
  /** 月 K 连续站上 MA4 的月数。 */
  monthDays?: number;
  /** MA4 上叉 MA7 已持续的交易日数；未上叉为 0。 */
  crossDays?: number;
  /** 当前这些条件同时成立的交易日数。 */
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
  crosses: SectorMa4Cross[];
  members: SectorMa4Member[];
};

export type ScreenerBoardRef = {
  code: string;
  name: string;
};

export type Ma4StandHit = {
  code: string;
  name: string;
  days: number;
  since: string;
  sector: string;
  sectorCode: string;
  /** 同时在红框里的行业和概念，行业在前。行业或概念有一个即可。 */
  boards: ScreenerBoardRef[];
  price: number | null;
  pct: number | null;
  turnover: number | null;
  ma4CrossUpMa7: boolean;
  weekOnMa4: boolean;
  weekOnMa7: boolean;
  monthOnMa4: boolean;
  weekDays: number;
  monthDays: number;
  /** MA4 上叉 MA7 已持续的交易日数；未上叉为 0。 */
  crossDays: number;
  /** 右侧这些条件同时成立的交易日数。 */
  holdDays: number;
};

function maAt(values: number[], period: number, index: number): number | null {
  if (index < period - 1 || index >= values.length) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += values[i];
  return sum / period;
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
  const ma = maAt(closes, period, index);
  return ma != null && ma > 0 && spot >= ma;
}

function closeOnMa4(closes: number[], index: number, spot = closes[index]): boolean {
  return closeOnMa(closes, 4, index, spot);
}

function consecutiveOnPeriods(closes: number[], periods: number[], spot?: number | null): number {
  const minIndex = Math.max(...periods) - 1;
  if (closes.length <= minIndex) return 0;
  const last = closes.length - 1;
  const lastSpot = spot != null && spot > 0 ? spot : closes[last];
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
  const lines: string[] = [];
  if (hit.weekOnMa4 && hit.weekOnMa7 !== false) lines.push(`周${Math.max(hit.weekDays, 1)}周`);
  lines.push(`日${hit.days}日`);
  return lines;
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
        monthDays: 0,
        crossDays: 0,
        holdDays: cross.days,
      };
    }
    const closes = stock.bars.map((bar) => bar.close);
    const weekMa4 = periodStand(dailyToWeekly(stock.bars), stock.price);
    const week = periodStand(dailyToWeekly(stock.bars), stock.price, [4, 7]);
    const month = periodStand(dailyToMonthly(stock.bars), stock.price);
    const crossed = ma4CrossedUpMa7(closes);
    const crossDays = crossed ? consecutiveMa4AboveMa7(closes) : 0;
    const dailyDays = consecutiveOnMa4AndMa7(closes, stock.price) || cross.days;
    const dailySince =
      dailyDays && stock.bars.length >= dailyDays ? stock.bars[stock.bars.length - dailyDays]?.time : cross.time;
    const weekSince = week.on && week.since ? weekStart(week.since) : "";
    return {
      ...cross,
      days: dailyDays,
      time: dailySince || cross.time,
      ma4CrossUpMa7: crossed,
      weekOnMa4: weekMa4.on,
      weekOnMa7: week.on,
      monthOnMa4: month.on,
      weekDays: week.days,
      monthDays: month.days,
      crossDays,
      holdDays: conditionHoldDays({
        dailyDays,
        dailySince,
        weekOn: week.on,
        weekDays: week.days,
        weekSince,
        bars: stock.bars,
      }),
    };
  });
}

function isIndustryBoard(code: string): boolean {
  return /^881\d{3}$/.test(code.trim());
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

function hitRank(hit: Ma4StandHit): number[] {
  return [hit.holdDays || hit.days, hit.days];
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

/**
 * 必须：个股属于行业或概念红框（开着且盖住最新一根），日 K 站上 MA4 和 MA7，周 K 站上 MA4 和 MA7。
 * 只过行业或只过概念都可以。按这些条件同时成立的交易日数从短到长排。同一只股票只留一条。不含科创、创业、北交所、ST。
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
      if (!cross.weekOnMa4 || !cross.weekOnMa7) continue;
      const ma4CrossUpMa7 = Boolean(cross.ma4CrossUpMa7);
      const weekOnMa4 = Boolean(cross.weekOnMa4);
      const weekOnMa7 = Boolean(cross.weekOnMa7);
      const monthOnMa4 = Boolean(cross.monthOnMa4);
      const weekDays = cross.weekDays ?? 0;
      const monthDays = cross.monthDays ?? 0;
      const crossDays = ma4CrossUpMa7 ? Math.max(cross.crossDays ?? 1, 1) : 0;
      const hit = withBoards(
        {
          code: cross.code,
          name,
          days: cross.days,
          since: cross.time,
          sector: sector.name,
          sectorCode: sector.code,
          boards: [{ code: sector.code, name: sector.name }],
          price: member?.price ?? null,
          pct: member?.pct ?? null,
          turnover: member?.turnover ?? null,
          ma4CrossUpMa7,
          weekOnMa4,
          weekOnMa7,
          monthOnMa4,
          weekDays,
          monthDays,
          crossDays,
          holdDays:
            cross.holdDays ??
            conditionHoldDays({
              dailyDays: cross.days,
              dailySince: cross.time,
              weekOn: weekOnMa4 && weekOnMa7,
              weekDays,
            }),
        },
        [{ code: sector.code, name: sector.name }],
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
  return [...best.values()].sort((a, b) => {
    const left = hitRank(a);
    const right = hitRank(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
}
