import { cached } from "../cache";
import { bareCode, isTonghuashunBoard, isTonghuashunConcept, isTonghuashunIndustry } from "../codes";
import { toNumber } from "../format";
import { fetchGbk, fetchUtf, firstOk, retryOk, UpstreamError } from "../http";
import { parseTonghuashunSwIndustry } from "../thsSwIndustry";
import { mapPool } from "../pool";
import { isShanghaiWeekend, thsRealtimeTradeDate, withToday } from "../thsRealtime";
import type { BoardMember, KBar, SectorItem } from "../types";

const LIST_REFERER = "https://q.10jqka.com.cn/thshy/";
const CONCEPT_REFERER = "https://q.10jqka.com.cn/gn/";

type Series = {
  name: string;
  bars: KBar[];
};

function decodeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function cellHtmls(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function tableRows(html: string): string[] {
  const bodies = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/gi)].map((match) => match[1]);
  let best: string[] = [];
  for (const body of bodies) {
    const rows = body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    const wide = rows.filter((row) => (row.match(/<td\b/gi) ?? []).length >= 10);
    if (wide.length > best.length) best = wide;
  }
  return best;
}

function firstLink(html: string): { href: string; text: string } | null {
  const match = html.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  if (!match) return null;
  const text = decodeText(match[2]);
  return text ? { href: match[1], text } : null;
}

function parseCnNumber(value: string): number | null {
  const text = value.replace(/,/g, "").trim();
  const match = text.match(/^(-?\d+(?:\.\d+)?)(万亿|亿|万)?$/);
  if (!match) return toNumber(text);
  const base = Number(match[1]);
  const unit = match[2];
  const scale = unit === "万亿" ? 1e12 : unit === "亿" ? 1e8 : unit === "万" ? 1e4 : 1;
  return Number.isFinite(base) ? base * scale : null;
}

function directoryNames(html: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const match of html.matchAll(/detail\/code\/(881\d{3})\/"[^>]*>\s*([^<]+?)\s*</g)) {
    const name = decodeText(match[2]);
    if (name) names.set(match[1], name);
  }
  return names;
}

export function parseTonghuashunIndustryHtml(html: string): SectorItem[] {
  return parseBoardRows(html);
}

export async function fetchTonghuashunStockIndustry(code: string): Promise<string | null> {
  const id = bareCode(code);
  if (!/^\d{6}$/.test(id)) return null;
  const referer = `https://stockpage.10jqka.com.cn/${id}/`;
  try {
    const html = await firstOk([
      () => readHtml(`https://basic.10jqka.com.cn/${id}/company.html`, referer),
      () => readHtml(`https://basic.10jqka.com.cn/new/${id}/company.html`, referer),
    ]);
    return parseTonghuashunSwIndustry(html);
  } catch {
    return null;
  }
}

function parseBoardRows(html: string): SectorItem[] {
  const items: SectorItem[] = [];
  for (const row of tableRows(html)) {
    const cells = cellHtmls(row);
    if (cells.length < 8) continue;
    let board: { href: string; text: string } | null = null;
    let code: string | undefined;
    let leader: { href: string; text: string } | null = null;
    for (const cell of cells) {
      const link = firstLink(cell);
      if (!link) continue;
      const found = link.href.match(/\/(881\d{3})\/?/)?.[1];
      if (found) {
        board = link;
        code = found;
        continue;
      }
      if (!leader) leader = link;
    }
    if (!code || !board) continue;
    let pct = toNumber(decodeText(cells[2] ?? ""));
    if (pct != null && Math.abs(pct) > 40) pct = null;
    if (pct == null) {
      for (const cell of cells) {
        const text = decodeText(cell);
        if (/%$/.test(text)) {
          pct = toNumber(text.replace(/%$/, ""));
          break;
        }
      }
    }
    const quoteLayout = Boolean(firstLink(cells[1] ?? "")?.href.match(/\/(881\d{3})\/?/) && firstLink(cells[9] ?? ""));
    const leaderCode = leader?.href.match(/\/(\d{6})\/?/)?.[1] ?? null;
    items.push({
      code,
      name: board.text,
      pct,
      price: null,
      leader: leader?.text ?? null,
      leaderCode,
      upCount: quoteLayout ? toNumber(decodeText(cells[6] ?? "")) : null,
      downCount: quoteLayout ? toNumber(decodeText(cells[7] ?? "")) : null,
      source: "ths",
    });
  }
  return items;
}

function parseMemberRows(html: string): BoardMember[] {
  const items: BoardMember[] = [];
  for (const row of tableRows(html)) {
    const cells = cellHtmls(row);
    if (cells.length < 11) continue;
    const code = decodeText(cells[1] ?? "");
    const name = decodeText(cells[2] ?? "");
    if (!/^\d{6}$/.test(code) || !name) continue;
    items.push({
      code,
      name,
      price: toNumber(decodeText(cells[3] ?? "")),
      pct: toNumber(decodeText(cells[4] ?? "")),
      turnover: toNumber(decodeText(cells[7] ?? "")),
      amount: parseCnNumber(decodeText(cells[10] ?? "")),
    });
  }
  return items;
}

async function readHtml(url: string, referer: string): Promise<string> {
  return retryOk(2, () => fetchGbk(url, { referer, timeoutMs: 12_000 }));
}

export async function fetchTonghuashunIndustries(): Promise<SectorItem[]> {
  let pageOne = "";
  try {
    pageOne = await firstOk([
      () => readHtml("https://q.10jqka.com.cn/thshy/", LIST_REFERER),
      () => readHtml("https://data.10jqka.com.cn/funds/hyzjl/", "https://data.10jqka.com.cn/funds/hyzjl/"),
    ]);
  } catch {
    throw new UpstreamError("同花顺行业名单暂时读不到");
  }
  const pageTwo = pageOne.includes("q.10jqka.com.cn/thshy/")
    ? await readHtml("https://q.10jqka.com.cn/thshy/index/field/199112/order/desc/page/2/", LIST_REFERER).catch(
        () => "",
      )
    : "";

  const quoted: SectorItem[] = [];
  const seen = new Set<string>();
  for (const item of [...parseBoardRows(pageOne), ...parseBoardRows(pageTwo)]) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    quoted.push(item);
  }
  const names = directoryNames(pageOne);
  for (const [code, name] of names) {
    if (seen.has(code)) continue;
    seen.add(code);
    quoted.push({
      code,
      name,
      pct: null,
      price: null,
      leader: null,
      leaderCode: null,
      upCount: null,
      downCount: null,
      source: "ths",
    });
  }
  if (quoted.length < 10) throw new UpstreamError("同花顺行业名单暂时读不到");
  return quoted;
}

async function fetchMemberPages(base: string, limit: number, emptyMessage: string): Promise<BoardMember[]> {
  const pages = Math.min(4, Math.max(1, Math.ceil(limit / 10)));
  const members: BoardMember[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= pages && members.length < limit; page += 1) {
    const url = page === 1 ? base : `${base}page/${page}/`;
    let html = "";
    try {
      html = await readHtml(url, base);
    } catch {
      if (members.length) break;
      throw new UpstreamError(emptyMessage);
    }
    let added = 0;
    for (const item of parseMemberRows(html)) {
      if (seen.has(item.code)) continue;
      seen.add(item.code);
      members.push(item);
      added += 1;
      if (members.length >= limit) break;
    }
    if (!added) break;
  }
  return members.slice(0, limit);
}

const conceptDetailCodes = new Map<string, string>();

type ConceptCatalog = {
  items: SectorItem[];
  detailCodes: Record<string, string>;
};

function parseConceptSection(html: string): Map<string, { plate: string; name: string; pct: number | null }> {
  const raw = html.match(/id="gnSection" value='([^']*)'/)?.[1] ?? "";
  const rows = new Map<string, { plate: string; name: string; pct: number | null }>();
  if (!raw) return rows;
  let parsed: Record<string, { platecode?: string; platename?: string; cid?: string; "199112"?: number }> = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return rows;
  }
  for (const row of Object.values(parsed)) {
    const cid = row.cid?.trim() ?? "";
    const plate = row.platecode?.trim() ?? "";
    const name = decodeText(row.platename ?? "");
    if (!/^\d{6}$/.test(cid) || !isTonghuashunConcept(plate) || !name) continue;
    rows.set(cid, { plate, name, pct: toNumber(row["199112"]) });
  }
  return rows;
}

function parseConceptDirectory(html: string): Array<{ cid: string; name: string }> {
  const items: Array<{ cid: string; name: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/gn\/detail\/code\/(\d{6})\/"[^>]*>\s*([^<]+?)\s*</g)) {
    const cid = match[1];
    const name = decodeText(match[2]);
    if (!name || seen.has(cid)) continue;
    seen.add(cid);
    items.push({ cid, name });
  }
  return items;
}

async function conceptPlateCode(cid: string): Promise<string | null> {
  try {
    const html = await readHtml(`https://q.10jqka.com.cn/gn/detail/code/${cid}/`, CONCEPT_REFERER);
    const plate = html.match(/id="clid" value='(\d{6})'/)?.[1] ?? "";
    return isTonghuashunConcept(plate) ? plate : null;
  } catch {
    return null;
  }
}

async function loadConceptCatalog(): Promise<ConceptCatalog> {
  let html = "";
  try {
    html = await firstOk([
      () => readHtml("https://q.10jqka.com.cn/gn/", CONCEPT_REFERER),
      () => readHtml("https://data.10jqka.com.cn/funds/gnzjl/", "https://data.10jqka.com.cn/funds/gnzjl/"),
    ]);
  } catch {
    throw new UpstreamError("同花顺概念名单暂时读不到");
  }
  const quoted = parseConceptSection(html);
  const detailCodes: Record<string, string> = {};
  const items: SectorItem[] = [];
  const seen = new Set<string>();
  for (const [cid, row] of quoted) {
    if (seen.has(row.plate)) continue;
    seen.add(row.plate);
    detailCodes[row.plate] = cid;
    items.push({
      code: row.plate,
      name: row.name,
      pct: row.pct,
      price: null,
      leader: null,
      leaderCode: null,
      upCount: null,
      downCount: null,
      source: "ths",
    });
  }
  const missing = parseConceptDirectory(html).filter((item) => !quoted.has(item.cid));
  const resolved = await mapPool(missing, 8, async (item) => {
    const plate = await conceptPlateCode(item.cid);
    return plate ? { ...item, plate } : null;
  });
  for (const item of resolved) {
    if (!item || seen.has(item.plate)) continue;
    seen.add(item.plate);
    detailCodes[item.plate] = item.cid;
    items.push({
      code: item.plate,
      name: item.name,
      pct: null,
      price: null,
      leader: null,
      leaderCode: null,
      upCount: null,
      downCount: null,
      source: "ths",
    });
  }
  if (items.length < 100) throw new UpstreamError("同花顺概念名单暂时读不到");
  return { items, detailCodes };
}

export async function fetchTonghuashunConcepts(): Promise<SectorItem[]> {
  const catalog = await cached("ths-concept-boards", 10 * 60_000, loadConceptCatalog);
  conceptDetailCodes.clear();
  for (const [plate, cid] of Object.entries(catalog.detailCodes)) conceptDetailCodes.set(plate, cid);
  return catalog.items;
}

async function conceptDetailCode(plate: string): Promise<string | null> {
  const known = conceptDetailCodes.get(plate);
  if (known) return known;
  await fetchTonghuashunConcepts();
  return conceptDetailCodes.get(plate) ?? null;
}

export async function fetchTonghuashunMembers(code: string, limit = 40): Promise<BoardMember[]> {
  if (isTonghuashunIndustry(code)) {
    return fetchMemberPages(
      `https://q.10jqka.com.cn/thshy/detail/code/${code}/`,
      limit,
      "同花顺行业成分股暂时读不到",
    );
  }
  if (!isTonghuashunConcept(code)) return [];
  const cid = await conceptDetailCode(code);
  if (!cid) return [];
  return fetchMemberPages(
    `https://q.10jqka.com.cn/gn/detail/code/${cid}/`,
    limit,
    "同花顺概念成分股暂时读不到",
  );
}

function parseJsonp<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new UpstreamError("同花顺板块指数日线暂时取不到");
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new UpstreamError("同花顺板块指数日线暂时取不到");
  }
}

function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function boardReferer(code: string): string {
  return isTonghuashunConcept(code) ? CONCEPT_REFERER : `https://q.10jqka.com.cn/thshy/detail/code/${code}/`;
}

/** 日线文件只到上一个交易日。盘中的这一根在实时行情里。 */
async function fetchTonghuashunToday(code: string): Promise<KBar | null> {
  const referer = boardReferer(code);
  try {
    const text = await fetchUtf(`https://d.10jqka.com.cn/v6/realhead/48_${code}/last.js`, {
      referer,
      timeoutMs: 8_000,
    });
    const payload = parseJsonp<{ items?: Record<string, string> }>(text);
    const items = payload.items;
    if (!items) return null;
    const date = thsRealtimeTradeDate(items);
    if (!date || isShanghaiWeekend(date)) return null;
    const open = positive(items["7"]);
    const high = positive(items["8"]);
    const low = positive(items["9"]);
    const close = positive(items["10"]);
    if (open == null || high == null || low == null || close == null) return null;
    const volume = Number(items["13"]);
    const turnover = Number(items["19"]);
    return {
      time: date,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      turnover: Number.isFinite(turnover) ? turnover : null,
    };
  } catch {
    return null;
  }
}

async function fetchTonghuashunHistory(code: string, count: number): Promise<Series> {
  const referer = boardReferer(code);
  let text = "";
  try {
    text = await fetchUtf(`https://d.10jqka.com.cn/v6/line/48_${code}/01/last.js`, {
      referer,
      timeoutMs: 12_000,
    });
  } catch {
    throw new UpstreamError("同花顺板块指数日线暂时取不到");
  }
  const payload = parseJsonp<{ name?: string; data?: string }>(text);
  const bars: KBar[] = [];
  for (const row of String(payload.data ?? "").split(";")) {
    if (!row) continue;
    const fields = row.split(",");
    const date = fields[0] ?? "";
    const matched = date.match(/^(\d{4})(\d{2})(\d{2})$/);
    const open = Number(fields[1]);
    const high = Number(fields[2]);
    const low = Number(fields[3]);
    const close = Number(fields[4]);
    const volume = Number(fields[5]);
    const turnover = Number(fields[6]);
    if (!matched || ![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) continue;
    const time = `${matched[1]}-${matched[2]}-${matched[3]}`;
    if (isShanghaiWeekend(time)) continue;
    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      turnover: Number.isFinite(turnover) ? turnover : null,
    });
  }
  const sliced = bars.slice(-Math.max(1, count));
  if (sliced.length < 2) throw new UpstreamError("同花顺板块指数日线暂时取不到");
  return { name: payload.name?.trim() || code, bars: sliced };
}

export async function fetchTonghuashunSeries(code: string, count = 160): Promise<Series> {
  if (!isTonghuashunBoard(code)) {
    throw new UpstreamError("请从同花顺行业或概念里选择一个板块", 400);
  }
  const history = await cached(`ths-kline-hist:v2:${code}:${count}`, 10 * 60_000, () =>
    fetchTonghuashunHistory(code, count),
  );
  const today = await cached(`ths-kline-today:v3:${code}`, 20_000, () => fetchTonghuashunToday(code));
  const room = Math.max(1, count);
  const bars = withToday(history.bars, today).slice(-room);
  return { name: history.name, bars };
}
