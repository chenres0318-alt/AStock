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

export type Ma4StandHit = {
  code: string;
  name: string;
  days: number;
  since: string;
  sector: string;
  sectorCode: string;
  price: number | null;
  pct: number | null;
  turnover: number | null;
  ma4CrossUpMa7: boolean;
  weekOnMa4: boolean;
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

/** 用日 K 拼周 K，当周未走完也算一根，收盘用最近一个交易日。 */
export function dailyToWeekly(bars: KBar[]): KBar[] {
  const groups = new Map<string, KBar[]>();
  for (const bar of bars) {
    const key = weekStart(bar.time);
    const list = groups.get(key);
    if (list) list.push(bar);
    else groups.set(key, [bar]);
  }
  const weeks: KBar[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const last = list[list.length - 1];
    weeks.push({
      time: last.time,
      open: first.open,
      high: Math.max(...list.map((item) => item.high)),
      low: Math.min(...list.map((item) => item.low)),
      close: last.close,
      volume: list.reduce((sum, item) => sum + item.volume, 0),
    });
  }
  return weeks;
}

/** 最新一根日线：前一日 MA4 还在 MA7 下方或持平，当日 MA4 站上 MA7。 */
export function ma4CrossedUpMa7(closes: number[], index = closes.length - 1): boolean {
  const ma4 = maAt(closes, 4, index);
  const ma4Prev = maAt(closes, 4, index - 1);
  const ma7 = maAt(closes, 7, index);
  const ma7Prev = maAt(closes, 7, index - 1);
  if (ma4 == null || ma4Prev == null || ma7 == null || ma7Prev == null) return false;
  return ma4Prev <= ma7Prev && ma4 > ma7;
}

export function weekStandsOnMa4(bars: KBar[], price?: number | null): boolean {
  const weeks = dailyToWeekly(bars);
  if (weeks.length < 4) return false;
  const closes = weeks.map((bar) => bar.close);
  const last = closes.length - 1;
  const spot = price != null && price > 0 ? price : closes[last];
  const ma4 = maAt(closes, 4, last);
  return ma4 != null && ma4 > 0 && spot >= ma4;
}

export function decorateMa4Crosses(
  crosses: SectorMa4Cross[],
  stocks: Array<{ code: string; bars: KBar[]; price?: number | null }>,
): SectorMa4Cross[] {
  const byCode = new Map(stocks.map((stock) => [stock.code, stock]));
  return crosses.map((cross) => {
    const stock = byCode.get(cross.code);
    if (!stock) return { ...cross, ma4CrossUpMa7: false, weekOnMa4: false };
    const closes = stock.bars.map((bar) => bar.close);
    return {
      ...cross,
      ma4CrossUpMa7: ma4CrossedUpMa7(closes),
      weekOnMa4: weekStandsOnMa4(stock.bars, stock.price),
    };
  });
}

function hitRank(hit: Ma4StandHit): [number, number, number] {
  return [hit.ma4CrossUpMa7 ? 0 : 1, hit.weekOnMa4 ? 0 : 1, hit.days];
}

function betterHit(next: Ma4StandHit, prev: Ma4StandHit | undefined): boolean {
  if (!prev) return true;
  const a = hitRank(next);
  const b = hitRank(prev);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return next.sector.localeCompare(prev.sector, "zh-CN") < 0;
}

/**
 * 红框覆盖最新一根、且板块指数站上 MA4 的行业里，
 * 收盘站上 MA4 的成分股：MA4 上叉 MA7 更靠前，周 K 站上 MA4 更靠前，再按连续站上天数从短到长。
 * 同一只股票只留排序更靠前的那条。不含科创、创业、北交所、ST。
 */
export function collectMa4StandHits(sectors: SectorMa4Screen[]): Ma4StandHit[] {
  const best = new Map<string, Ma4StandHit>();
  for (const sector of sectors) {
    if (!sector.onMa4) continue;
    const open = sector.openTrend;
    if (!open || open.status !== "open" || !sector.lastTime || open.end !== sector.lastTime) continue;
    const members = new Map(sector.members.map((item) => [item.code, item]));
    for (const cross of sector.crosses) {
      const member = members.get(cross.code);
      const name = cross.name || member?.name || cross.code;
      if (!isScreenerShare(cross.code, name)) continue;
      const hit: Ma4StandHit = {
        code: cross.code,
        name,
        days: cross.days,
        since: cross.time,
        sector: sector.name,
        sectorCode: sector.code,
        price: member?.price ?? null,
        pct: member?.pct ?? null,
        turnover: member?.turnover ?? null,
        ma4CrossUpMa7: Boolean(cross.ma4CrossUpMa7),
        weekOnMa4: Boolean(cross.weekOnMa4),
      };
      if (betterHit(hit, best.get(hit.code))) best.set(hit.code, hit);
    }
  }
  return [...best.values()].sort((a, b) => {
    const left = hitRank(a);
    const right = hitRank(b);
    for (let i = 0; i < 3; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
}
