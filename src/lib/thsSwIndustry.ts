import type { SectorItem } from "./types";

function decodeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/** 同花顺行业新闻页里的 881 板块，例如 list/field/0881134。 */
export function parseTonghuashunFieldIndustry(html: string): string | null {
  const match = html.match(/list\/field\/0?(881\d{3})/i) ?? html.match(/thshy\/detail\/code\/(881\d{3})/i);
  return match?.[1] ?? null;
}

/** 同花顺公司页「所属申万行业」，例如「汽车 — 汽车零部件」。 */
export function parseTonghuashunSwIndustry(html: string): string | null {
  const patterns = [
    /所属申万行业[：:]?\s*<\/strong>\s*<span>([\s\S]*?)<\/span>/i,
    /所属申万行业[：:]?\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const text = decodeText(match[1]);
    if (text && text !== "-") return text;
  }
  return null;
}

const SW_LEVEL_MARK = /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/;

/** 申万叶子在同花顺 881 名单里用了别的名字。 */
const SW_ALIASES: Record<string, string[]> = {
  油服工程: ["油气开采及服务"],
  通信: ["通信设备"],
};

function withAliases(keys: string[]): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    if (name && !out.includes(name)) out.push(name);
  };
  for (const key of keys) {
    push(key);
    for (const alias of SW_ALIASES[key] ?? []) push(alias);
  }
  return out;
}

/** 同花顺申万路径从叶子到上级，去掉 ⅠⅡⅢ。 */
export function swIndustryCandidates(industry: string): string[] {
  const parts = industry
    .split(/\s*[—–\-/]\s*/)
    .map((part) => decodeText(part))
    .filter((part) => part && part !== "-");
  const keys: string[] = [];
  const push = (name: string) => {
    if (name && !keys.includes(name)) keys.push(name);
  };
  for (const part of [...parts].reverse()) {
    push(part);
    const stripped = part.replace(SW_LEVEL_MARK, "").trim();
    if (stripped !== part) push(stripped);
  }
  return keys;
}

/** 按同花顺行业名单精确匹配申万叶子，没有叶子再试上级，避免「汽车」误落到汽车服务。 */
export function matchTonghuashunIndustry(industry: string, boards: SectorItem[]): SectorItem | null {
  const keys = withAliases(swIndustryCandidates(industry));
  for (const key of keys) {
    const exact = boards.find((item) => item.name === key);
    if (exact) return exact;
  }
  for (const key of keys) {
    if (key.length < 2) continue;
    const hits = boards.filter((item) => item.name.includes(key));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

const ETF_NOISE =
  /ETF|LOF|基金|联接|交易型开放式指数证券投资基金|国泰|国联安|易方达|华夏|南方|工银|嘉实|广发|华安|博时|富国|招商|银华|鹏华|汇添富|中证|国证|全指|主题/gi;

/** ETF 没有公司页申万行业，用名称里最长的同花顺行业名。 */
export function matchBoardFromHoldingName(name: string, boards: SectorItem[]): SectorItem | null {
  const text = name.replace(/\s+/g, "").trim();
  if (!text) return null;
  const contained = boards.filter((item) => item.name && text.includes(item.name));
  if (contained.length) {
    return [...contained].sort((a, b) => b.name.length - a.name.length)[0];
  }
  const cleaned = text.replace(ETF_NOISE, "").trim();
  return matchTonghuashunIndustry(cleaned, boards);
}

/** 优先用同花顺行业名单解析结果；暂时读不到时只保留已有的 881 板块。 */
export function keepTonghuashunHoldingBoard(
  item: { sector: string | null; sectorCode: string | null },
  resolved: { sector: string; sectorCode: string } | null,
): { sector: string | null; sectorCode: string | null } {
  if (resolved) return { sector: resolved.sector, sectorCode: resolved.sectorCode };
  if (item.sectorCode && /^881\d{3}$/.test(item.sectorCode.trim())) {
    return { sector: item.sector, sectorCode: item.sectorCode };
  }
  return { sector: item.sector, sectorCode: null };
}
