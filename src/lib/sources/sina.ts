import { cached } from "../cache";
import { marketOf, toSinaCode, toTencentCode } from "../codes";
import { toNumber } from "../format";
import { fetchGbk, fetchUtf } from "../http";
import type { BoardMember, KBar, RankItem, SearchItem, SectorItem } from "../types";

type SinaRankRow = {
  symbol?: string;
  code?: string;
  name?: string;
  trade?: string | number;
  pricechange?: string | number;
  changepercent?: string | number;
  volume?: string | number;
  amount?: string | number;
  turnoverratio?: string | number;
};

export type SinaNodeSort = "changepercent" | "amount" | "turnoverratio";

async function fetchSinaNodeRows(
  node: string,
  num: number,
  sort: SinaNodeSort,
  asc: 0 | 1 = 0,
): Promise<SinaRankRow[]> {
  const url =
    `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
    `?page=1&num=${num}&sort=${sort}&asc=${asc}&node=${encodeURIComponent(node)}&_s_r_a=page`;
  const text = await fetchUtf(url, {
    referer: "https://vip.stock.finance.sina.com.cn/",
    timeoutMs: 10000,
  });
  const rows = JSON.parse(text) as SinaRankRow[];
  return Array.isArray(rows) ? rows : [];
}

function mapRankRow(row: SinaRankRow): RankItem {
  const symbol = String(row.symbol ?? "");
  const code = symbol || toTencentCode(String(row.code ?? ""));
  return {
    code: toTencentCode(code),
    name: String(row.name ?? row.code ?? ""),
    price: toNumber(row.trade),
    change: toNumber(row.pricechange),
    pct: toNumber(row.changepercent),
    volume: toNumber(row.volume),
    amount: toNumber(row.amount),
    turnover: toNumber(row.turnoverratio),
  };
}

export async function fetchSinaRank(
  sort: "changepercent" | "amount",
  asc: 0 | 1,
  num = 40,
): Promise<RankItem[]> {
  const rows = await fetchSinaNodeRows("hs_a", num, sort, asc);
  return rows.map(mapRankRow).filter((row) => row.code && row.name);
}

export async function fetchSinaBoardMembers(
  node: string,
  limit = 50,
  sort: SinaNodeSort = "amount",
): Promise<BoardMember[]> {
  const rows = await fetchSinaNodeRows(node, limit, sort, 0);
  return rows
    .map((row) => {
      const mapped = mapRankRow(row);
      return {
        code: mapped.code,
        name: mapped.name,
        price: mapped.price,
        pct: mapped.pct,
        amount: mapped.amount,
        turnover: mapped.turnover,
      } satisfies BoardMember;
    })
    .filter((item) => item.code && item.name);
}

function parseSinaIndustryMap(text: string): Record<string, string> {
  const eq = text.indexOf("=");
  const jsonText = (eq >= 0 ? text.slice(eq + 1) : text).trim().replace(/;+\s*$/, "");
  return JSON.parse(jsonText) as Record<string, string>;
}

export async function fetchSinaIndustries(): Promise<SectorItem[]> {
  return cached("sina-industries", 5 * 60_000, async () => {
    const text = await fetchGbk("https://money.finance.sina.com.cn/q/view/newFLJK.php?param=industry", {
      referer: "https://finance.sina.com.cn/",
      timeoutMs: 10000,
    });
    const obj = parseSinaIndustryMap(text);
    const items: SectorItem[] = [];
    for (const [key, raw] of Object.entries(obj)) {
      const parts = String(raw).split(",");
      const code = parts[0] || key;
      const name = parts[1] || code;
      const leaderCode = parts[8] ? toTencentCode(parts[8]) : null;
      const leaderName = parts[12] || null;
      if (!code.startsWith("hangye_")) continue;
      items.push({
        code,
        name,
        price: toNumber(parts[3]),
        pct: toNumber(parts[5]),
        leader: leaderName,
        leaderCode,
        upCount: null,
        downCount: null,
        source: "sina",
      });
    }
    items.sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999));
    return items;
  });
}

export async function fetchSinaSuggest(keyword: string): Promise<SearchItem[]> {
  const url = `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15,21&key=${encodeURIComponent(keyword)}`;
  const text = await fetchGbk(url, { referer: "https://finance.sina.com.cn/" });
  const matched = text.match(/suggestvalue="([^"]*)"/);
  if (!matched?.[1]) return [];
  return matched[1]
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const parts = chunk.split(",");
      const name = parts[0] || parts[4] || "";
      const symbol = parts[3] || "";
      const code = toSinaCode(symbol || parts[2] || "");
      const typeName = parts[5] || "A股";
      return {
        code,
        name,
        market: marketOf(code),
        typeName: typeName || marketOf(code),
      } satisfies SearchItem;
    })
    .filter((item) => /^\d{6}$/.test(item.code.slice(2)));
}

export async function fetchSinaKline(code: string, count = 80): Promise<KBar[]> {
  const symbol = toSinaCode(code);
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${symbol}&scale=240&ma=no&datalen=${count}`;
  const text = await fetchUtf(url, { referer: "https://finance.sina.com.cn/", timeoutMs: 8000 });
  const rows = JSON.parse(text) as Array<{
    day?: string;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
  }>;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const open = toNumber(row.open);
      const high = toNumber(row.high);
      const low = toNumber(row.low);
      const close = toNumber(row.close);
      if (!row.day || open == null || high == null || low == null || close == null) return null;
      return {
        time: row.day,
        open,
        high,
        low,
        close,
        volume: toNumber(row.volume) ?? 0,
      } satisfies KBar;
    })
    .filter((item): item is KBar => item != null);
}
