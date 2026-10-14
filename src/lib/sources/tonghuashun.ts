import { isTonghuashunIndustry } from "../codes";
import { toNumber } from "../format";
import { fetchGbk, fetchUtf, UpstreamError } from "../http";
import type { BoardMember, KBar, SectorItem } from "../types";

const LIST_REFERER = "https://q.10jqka.com.cn/thshy/";

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
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  return body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
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

function parseBoardRows(html: string): SectorItem[] {
  const items: SectorItem[] = [];
  for (const row of tableRows(html)) {
    const cells = cellHtmls(row);
    if (cells.length < 10) continue;
    const board = firstLink(cells[1] ?? "");
    const code = board?.href.match(/\/(881\d{3})\/?/)?.[1];
    if (!code || !board) continue;
    const leader = firstLink(cells[9] ?? "");
    const leaderCode = leader?.href.match(/\/(\d{6})\/?/)?.[1] ?? null;
    items.push({
      code,
      name: board.text,
      pct: toNumber(decodeText(cells[2] ?? "")),
      price: null,
      leader: leader?.text ?? null,
      leaderCode,
      upCount: toNumber(decodeText(cells[6] ?? "")),
      downCount: toNumber(decodeText(cells[7] ?? "")),
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
  return fetchGbk(url, { referer, timeoutMs: 12_000 });
}

export async function fetchTonghuashunIndustries(): Promise<SectorItem[]> {
  let pageOne = "";
  try {
    pageOne = await readHtml("https://q.10jqka.com.cn/thshy/", LIST_REFERER);
  } catch {
    throw new UpstreamError("同花顺行业名单暂时读不到");
  }
  const pageTwo = await readHtml(
    "https://q.10jqka.com.cn/thshy/index/field/199112/order/desc/page/2/",
    LIST_REFERER,
  ).catch(() => "");

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

export async function fetchTonghuashunMembers(code: string, limit = 40): Promise<BoardMember[]> {
  if (!isTonghuashunIndustry(code)) return [];
  const referer = `https://q.10jqka.com.cn/thshy/detail/code/${code}/`;
  const pages = Math.min(3, Math.max(1, Math.ceil(limit / 20)));
  const members: BoardMember[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= pages && members.length < limit; page += 1) {
    const url =
      page === 1
        ? referer
        : `https://q.10jqka.com.cn/thshy/detail/code/${code}/page/${page}/`;
    let html = "";
    try {
      html = await readHtml(url, referer);
    } catch {
      if (members.length) break;
      throw new UpstreamError("同花顺行业成分股暂时读不到");
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

export async function fetchTonghuashunSeries(code: string, count = 160): Promise<Series> {
  if (!isTonghuashunIndustry(code)) {
    throw new UpstreamError("请从同花顺行业里选择一个板块", 400);
  }
  const referer = `https://q.10jqka.com.cn/thshy/detail/code/${code}/`;
  let text = "";
  try {
    text = await fetchUtf(`https://d.10jqka.com.cn/v6/line/48_${code}/01/last.js`, {
      referer,
      timeoutMs: 12_000,
    });
  } catch {
    throw new UpstreamError("同花顺行业指数日线暂时取不到");
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new UpstreamError("同花顺行业指数日线暂时取不到");
  let payload: { name?: string; data?: string };
  try {
    payload = JSON.parse(text.slice(start, end + 1)) as { name?: string; data?: string };
  } catch {
    throw new UpstreamError("同花顺行业指数日线暂时取不到");
  }
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
    bars.push({
      time: `${matched[1]}-${matched[2]}-${matched[3]}`,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      turnover: Number.isFinite(turnover) ? turnover : null,
    });
  }
  const sliced = bars.slice(-Math.max(1, count));
  if (sliced.length < 2) throw new UpstreamError("同花顺行业指数日线暂时取不到");
  return { name: payload.name?.trim() || code, bars: sliced };
}
