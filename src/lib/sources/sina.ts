import { marketOf, toSinaCode, toTencentCode } from "../codes";
import { toNumber } from "../format";
import { fetchGbk, fetchUtf } from "../http";
import type { RankItem, SearchItem } from "../types";

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

export async function fetchSinaRank(
  sort: "changepercent" | "amount",
  asc: 0 | 1,
  num = 40,
): Promise<RankItem[]> {
  const url =
    `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
    `?page=1&num=${num}&sort=${sort}&asc=${asc}&node=hs_a&_s_r_a=page`;
  const text = await fetchUtf(url, {
    referer: "https://vip.stock.finance.sina.com.cn/",
    timeoutMs: 10000,
  });
  const rows = JSON.parse(text) as SinaRankRow[];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
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
      } satisfies RankItem;
    })
    .filter((row) => row.code && row.name);
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
