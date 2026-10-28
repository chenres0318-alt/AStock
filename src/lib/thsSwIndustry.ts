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

/** 同花顺公司页「所属申万行业」，例如「汽车 — 汽车零部件」。 */
export function parseTonghuashunSwIndustry(html: string): string | null {
  const match = html.match(/所属申万行业[：:]?\s*<\/strong>\s*<span>([\s\S]*?)<\/span>/i);
  if (!match) return null;
  const text = decodeText(match[1]);
  return text && text !== "-" ? text : null;
}

const SW_LEVEL_MARK = /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/;

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
  const keys = swIndustryCandidates(industry);
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
