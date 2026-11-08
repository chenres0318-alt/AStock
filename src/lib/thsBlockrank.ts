import type { BoardMember } from "./types";

function toNumber(value: unknown): number | null {
  if (value == null || value === "" || value === "-" || value === "--") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseJsonpObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type TonghuashunBlockrank = {
  members: BoardMember[];
  total: number;
};

/** 同花顺 d.10jqka.com.cn/v6/blockrank JSONP，字段 5=代码 55=名称 10=现价 199112=涨跌幅 19=成交额。 */
export function parseTonghuashunBlockrank(text: string): TonghuashunBlockrank {
  const payload = parseJsonpObject(text);
  const block = payload.block && typeof payload.block === "object" ? (payload.block as Record<string, unknown>) : {};
  const total = toNumber(block.subcodeCount) ?? 0;
  const raw = payload.items;
  if (!raw || typeof raw !== "object") return { members: [], total };
  const members: BoardMember[] = [];
  const seen = new Set<string>();
  for (const row of Object.values(raw as Record<string, Record<string, unknown>>)) {
    if (!row || typeof row !== "object") continue;
    const code = String(row["5"] ?? "").trim();
    const name = String(row["55"] ?? "").trim();
    if (!/^\d{6}$/.test(code) || !name || seen.has(code)) continue;
    seen.add(code);
    members.push({
      code,
      name,
      price: toNumber(row["10"]),
      pct: toNumber(row["199112"]),
      amount: toNumber(row["19"]),
      turnover: toNumber(row["1968584"]),
    });
  }
  return { members, total: Math.max(total, members.length) };
}

export function tonghuashunBlockrankUrl(code: string, limit: number): string {
  const count = Math.min(Math.max(Math.ceil(limit) || 10, 10), 200);
  return `https://d.10jqka.com.cn/v6/blockrank/${code}/199112/d${count}.js`;
}
