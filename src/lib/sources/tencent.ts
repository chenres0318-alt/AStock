import { marketOf, toTencentCode } from "../codes";
import { toNumber } from "../format";
import { fetchGbk, fetchJson } from "../http";
import type { KBar, KlinePeriod, Quote, OrderLevel, TrendPoint } from "../types";

type QtMap = Record<string, string[] | undefined>;

function levels(fields: string[], priceIdx: number, count: number): OrderLevel[] {
  const rows: OrderLevel[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      price: toNumber(fields[priceIdx + i * 2]),
      volume: toNumber(fields[priceIdx + i * 2 + 1]),
    });
  }
  return rows;
}

export function parseTencentQuotes(text: string): Quote[] {
  const quotes: Quote[] = [];
  const re = /v_([a-z]{2}\d{6})="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const code = match[1];
    const fields = match[2].split("~");
    if (fields.length < 33) continue;
    const price = toNumber(fields[3]);
    const preClose = toNumber(fields[4]);
    const pct = toNumber(fields[32]);
    const change = toNumber(fields[31]) ?? (price != null && preClose != null ? price - preClose : null);
    const amountWan = toNumber(fields[37]);
    quotes.push({
      code,
      name: fields[1] || code,
      market: marketOf(code),
      price,
      preClose,
      open: toNumber(fields[5]),
      high: toNumber(fields[33]),
      low: toNumber(fields[34]),
      change,
      pct,
      volume: toNumber(fields[6]),
      amount: amountWan != null ? amountWan * 10000 : null,
      turnover: toNumber(fields[38]),
      amplitude: toNumber(fields[43]),
      pe: toNumber(fields[39]),
      pb: toNumber(fields[46]),
      floatMv: toNumber(fields[44]),
      totalMv: toNumber(fields[45]),
      limitUp: toNumber(fields[47]),
      limitDown: toNumber(fields[48]),
      inner: toNumber(fields[8]),
      outer: toNumber(fields[7]),
      bids: levels(fields, 9, 5),
      asks: levels(fields, 19, 5),
      time: fields[30] || null,
      halted: price == null || price === 0,
    });
  }
  return quotes;
}

export async function fetchTencentQuotes(codes: string[]): Promise<Quote[]> {
  const unique = Array.from(new Set(codes.map(toTencentCode)));
  if (unique.length === 0) return [];
  const chunkSize = 50;
  const out: Quote[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const url = `https://qt.gtimg.cn/q=${chunk.join(",")}`;
    const text = await fetchGbk(url, { referer: "https://gu.qq.com/" });
    out.push(...parseTencentQuotes(text));
  }
  return out;
}

type TencentKlinePayload = {
  code?: number;
  data?: Record<
    string,
    {
      qfqday?: unknown[];
      day?: unknown[];
      qfqweek?: unknown[];
      week?: unknown[];
      qfqmonth?: unknown[];
      month?: unknown[];
    }
  >;
};

function parseKlineRows(rows: unknown[] | undefined): KBar[] {
  if (!rows) return [];
  const bars: KBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = String(row[0]);
    const open = toNumber(row[1]);
    const close = toNumber(row[2]);
    const high = toNumber(row[3]);
    const low = toNumber(row[4]);
    const volume = toNumber(row[5]);
    if (!time || open == null || close == null || high == null || low == null) continue;
    bars.push({ time, open, high, low, close, volume: volume ?? 0 });
  }
  return bars;
}

export async function fetchTencentKline(code: string, period: KlinePeriod, count = 180): Promise<KBar[]> {
  const tx = toTencentCode(code);
  const kind = period === "day" ? "day" : period === "week" ? "week" : "month";
  const url = `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${tx},${kind},,,${count},qfq`;
  const json = await fetchJson<TencentKlinePayload>(url, { referer: "https://gu.qq.com/" });
  const node = json.data?.[tx];
  const preferred =
    period === "day"
      ? node?.qfqday ?? node?.day
      : period === "week"
        ? node?.qfqweek ?? node?.week
        : node?.qfqmonth ?? node?.month;
  return parseKlineRows(preferred);
}

type MinutePayload = {
  data?: Record<
    string,
    {
      data?: {
        data?: string[];
        date?: string;
        prec?: string;
        "pre-close"?: string;
      };
      qt?: QtMap;
    }
  >;
};

export async function fetchTencentTrend(code: string): Promise<{
  points: TrendPoint[];
  preClose: number | null;
  tradeDate: string | null;
}> {
  const tx = toTencentCode(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${tx}`;
  const json = await fetchJson<MinutePayload>(url, { referer: "https://gu.qq.com/" });
  const node = json.data?.[tx];
  const rows = node?.data?.data ?? [];
  const preClose =
    toNumber(node?.data?.prec) ??
    toNumber(node?.data?.["pre-close"]) ??
    toNumber(node?.qt?.[tx]?.[4]);
  const tradeDate = node?.data?.date ? String(node.data.date) : null;
  const isoDate = tradeDate
    ? `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`
    : null;

  let prevVol = 0;
  let cumAmount = 0;
  const points: TrendPoint[] = [];
  for (const row of rows) {
    const parts = String(row).trim().split(/\s+/);
    if (parts.length < 3) continue;
    const hhmm = parts[0].padStart(4, "0");
    const price = toNumber(parts[1]);
    const cumVol = toNumber(parts[2]) ?? 0;
    const amount = toNumber(parts[3]);
    if (price == null) continue;
    const volume = Math.max(0, cumVol - prevVol);
    prevVol = cumVol;
    if (amount != null) cumAmount = amount;
    const avg = cumVol > 0 && cumAmount > 0 ? cumAmount / (cumVol * 100) : price;
    const hour = hhmm.slice(0, 2);
    const minute = hhmm.slice(2, 4);
    const iso = isoDate ? `${isoDate}T${hour}:${minute}:00+08:00` : `${hour}:${minute}`;
    const timestamp = Number.isFinite(Date.parse(iso)) ? Math.floor(Date.parse(iso) / 1000) : 0;
    points.push({
      time: `${hour}:${minute}`,
      timestamp,
      price,
      avg: Number.isFinite(avg) ? avg : price,
      volume,
    });
  }
  return { points, preClose, tradeDate };
}
