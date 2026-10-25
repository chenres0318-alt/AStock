import type { SectorItem } from "./types";

const INDUSTRY_ALIASES: Record<string, string[]> = {
  酿酒: ["白酒"],
  白酒: ["酿酒"],
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
};

function betterHit(next: Ma4StandHit, prev: Ma4StandHit | undefined): boolean {
  if (!prev) return true;
  if (next.days !== prev.days) return next.days < prev.days;
  return next.sector.localeCompare(prev.sector, "zh-CN") < 0;
}

/**
 * 红框覆盖最新一根、且板块指数站上 MA4 的行业里，
 * 收盘站上 MA4 的成分股按连续站上天数从短到长。
 * 同一只股票只留天数更短的那条。
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
      const hit: Ma4StandHit = {
        code: cross.code,
        name: cross.name,
        days: cross.days,
        since: cross.time,
        sector: sector.name,
        sectorCode: sector.code,
        price: member?.price ?? null,
        pct: member?.pct ?? null,
        turnover: member?.turnover ?? null,
      };
      if (betterHit(hit, best.get(hit.code))) best.set(hit.code, hit);
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.days !== b.days) return a.days - b.days;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}
