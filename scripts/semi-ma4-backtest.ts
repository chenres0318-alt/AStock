import iconv from "iconv-lite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runMa4StandBacktest, type BacktestResult, type EntryMode } from "../src/lib/ma4StandBacktest.ts";
import type { KBar } from "../src/lib/types.ts";

const BOARD = "881121";
const BOARD_NAME = "半导体";
const MEMBER_LIMIT = 100;
const SINA_BARS = 2048;
const TENCENT_BARS = 800;
const PERIODS = [
  { label: "2020.1.1–2023.10.1", start: "2020-01-01", end: "2023-10-01" },
  { label: "2023.1.1–2026.10.1", start: "2023-01-01", end: "2026-10-01" },
] as const;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type Member = { code: string; name: string; amount: number | null };
type StockSeries = { code: string; name: string; bars: KBar[] };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function read(url: string, init: { referer?: string; timeoutMs?: number; gbk?: boolean } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: init.referer ?? "https://q.10jqka.com.cn/",
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return init.gbk ? iconv.decode(buf, "gbk") : buf.toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

async function retry<T>(times: number, task: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < times; i += 1) {
    try {
      return await task();
    } catch (error) {
      last = error;
      await sleep(400 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error("retry failed");
}

function parseJsonp<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("jsonp");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

function decodeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCnNumber(value: string): number | null {
  const text = value.replace(/,/g, "").trim();
  const match = text.match(/^(-?\d+(?:\.\d+)?)(万亿|亿|万)?$/);
  if (!match) {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  const base = Number(match[1]);
  const unit = match[2];
  const scale = unit === "万亿" ? 1e12 : unit === "亿" ? 1e8 : unit === "万" ? 1e4 : 1;
  return Number.isFinite(base) ? base * scale : null;
}

function isWeekend(time: string): boolean {
  const day = new Date(`${time}T12:00:00+08:00`).getUTCDay();
  return day === 0 || day === 6;
}

function toTencent(code: string): string {
  const id = code.replace(/\D/g, "").slice(-6);
  if (id.startsWith("6") || id.startsWith("5") || id.startsWith("9")) return `sh${id}`;
  return `sz${id}`;
}

function parseBoardRows(data: string): KBar[] {
  const bars: KBar[] = [];
  for (const row of String(data ?? "").split(";")) {
    if (!row) continue;
    const fields = row.split(",");
    const matched = (fields[0] ?? "").match(/^(\d{4})(\d{2})(\d{2})$/);
    const open = Number(fields[1]);
    const high = Number(fields[2]);
    const low = Number(fields[3]);
    const close = Number(fields[4]);
    const volume = Number(fields[5]);
    const turnover = Number(fields[6]);
    if (!matched || ![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) continue;
    const time = `${matched[1]}-${matched[2]}-${matched[3]}`;
    if (isWeekend(time)) continue;
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
  return bars;
}

async function fetchBoardYear(year: number): Promise<KBar[]> {
  const referer = `https://q.10jqka.com.cn/thshy/detail/code/${BOARD}/`;
  const text = await retry(3, () =>
    read(`https://d.10jqka.com.cn/v6/line/48_${BOARD}/01/${year}.js`, { referer, timeoutMs: 15_000 }),
  );
  return parseBoardRows(parseJsonp<{ data?: string }>(text).data ?? "");
}

async function fetchBoardBars(): Promise<{ name: string; bars: KBar[] }> {
  const referer = `https://q.10jqka.com.cn/thshy/detail/code/${BOARD}/`;
  const text = await retry(3, () =>
    read(`https://d.10jqka.com.cn/v6/line/48_${BOARD}/01/last.js`, { referer, timeoutMs: 15_000 }),
  );
  const payload = parseJsonp<{ name?: string; data?: string; year?: Record<string, number> }>(text);
  const years = Object.keys(payload.year ?? {})
    .map(Number)
    .filter((year) => year >= 2019)
    .sort((a, b) => a - b);
  const want = years.length ? years : [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const bars: KBar[] = [];
  const seen = new Set<string>();
  for (const year of want) {
    for (const bar of await fetchBoardYear(year)) {
      if (seen.has(bar.time)) continue;
      seen.add(bar.time);
      bars.push(bar);
    }
    await sleep(120);
  }
  for (const bar of parseBoardRows(payload.data ?? "")) {
    if (seen.has(bar.time)) continue;
    seen.add(bar.time);
    bars.push(bar);
  }
  bars.sort((a, b) => a.time.localeCompare(b.time));
  if (bars.length < 200) throw new Error(`board bars too short: ${bars.length}`);
  return { name: payload.name?.trim() || BOARD_NAME, bars };
}

async function fetchMembers(): Promise<Member[]> {
  const members: Member[] = [];
  const seen = new Set<string>();
  const pages = Math.ceil(MEMBER_LIMIT / 10);
  const base = `https://q.10jqka.com.cn/thshy/detail/code/${BOARD}/`;
  for (let page = 1; page <= pages && members.length < MEMBER_LIMIT; page += 1) {
    const url = page === 1 ? base : `${base}page/${page}/`;
    const html = await retry(3, () => read(url, { referer: base, gbk: true, timeoutMs: 15_000 }));
    const bodies = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/gi)].map((match) => match[1]);
    let added = 0;
    for (const body of bodies) {
      const rows = body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
      for (const row of rows) {
        const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
        if (cells.length < 11) continue;
        const code = decodeText(cells[1] ?? "");
        const name = decodeText(cells[2] ?? "");
        if (!/^\d{6}$/.test(code) || !name || seen.has(code)) continue;
        seen.add(code);
        members.push({ code, name, amount: parseCnNumber(decodeText(cells[10] ?? "")) });
        added += 1;
        if (members.length >= MEMBER_LIMIT) break;
      }
      if (members.length >= MEMBER_LIMIT) break;
    }
    if (!added) break;
    await sleep(200);
  }
  members.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  if (members.length < 10) throw new Error(`members too few: ${members.length}`);
  return members;
}

function parseKlineRows(rows: unknown[] | undefined): KBar[] {
  if (!rows) return [];
  const bars: KBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = String(row[0]);
    const open = Number(row[1]);
    const close = Number(row[2]);
    const high = Number(row[3]);
    const low = Number(row[4]);
    const volume = Number(row[5]);
    const turnover = Number(row[7]);
    if (!time || ![open, close, high, low].every((value) => Number.isFinite(value))) continue;
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
  return bars;
}

function parseSinaBars(text: string): KBar[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) return [];
  const rows = JSON.parse(trimmed) as Array<{
    day?: string;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
  }>;
  const bars: KBar[] = [];
  for (const row of rows) {
    const time = String(row.day ?? "");
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume);
    if (!time || ![open, high, low, close].every((value) => Number.isFinite(value))) continue;
    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return bars;
}

async function fetchTencentBars(code: string): Promise<KBar[]> {
  const tx = toTencent(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${tx},day,,,${TENCENT_BARS},qfq`;
  const text = await retry(3, () => read(url, { referer: "https://gu.qq.com/", timeoutMs: 12_000 }));
  const json = JSON.parse(text) as {
    data?: Record<string, { qfqday?: unknown[]; day?: unknown[] }>;
  };
  return parseKlineRows(json.data?.[tx]?.qfqday ?? json.data?.[tx]?.day);
}

async function fetchStockBars(code: string): Promise<KBar[]> {
  const tx = toTencent(code);
  const sinaUrl =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${tx}&scale=240&ma=no&datalen=${SINA_BARS}`;
  try {
    const text = await retry(3, () =>
      read(sinaUrl, { referer: "https://finance.sina.com.cn/", timeoutMs: 12_000 }),
    );
    const bars = parseSinaBars(text);
    if (bars.length >= 30) return bars;
  } catch {
    // fall through to Tencent, which only covers the recent ~800 sessions
  }
  return fetchTencentBars(code);
}

async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        out[index] = await mapper(items[index]);
      }
    }),
  );
  return out;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function summarize(result: BacktestResult) {
  return {
    label: result.label,
    entryMode: result.entryMode,
    sameDayReentry: result.sameDayReentry,
    start: result.start,
    end: result.end,
    boxes: result.boxes,
    trades: result.trades.length,
    skippedNoMa4: result.skippedNoMa4,
    skippedNoStock: result.skippedNoStock,
    skippedNoCash: result.skippedNoCash,
    skippedOneDay: result.skippedOneDay,
    capital: result.capital,
    finalEquity: result.finalEquity,
    returnPct: result.returnPct,
    maxDrawdownPct: result.maxDrawdownPct,
    wins: result.trades.filter((trade) => trade.pnl > 0).length,
    losses: result.trades.filter((trade) => trade.pnl <= 0).length,
    tradePnls: result.trades.map((trade) => ({
      name: trade.name,
      code: trade.code,
      standDays: trade.standDays,
      entry: trade.entry,
      exit: trade.exit,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      shares: trade.shares,
      pnl: Number(trade.pnl.toFixed(2)),
      returnPct: trade.returnPct,
      reason: trade.reason,
      boxStart: trade.boxStart,
      boxEnd: trade.boxEnd,
    })),
    monthlyEquity: monthEnds(result.equity),
  };
}

function monthEnds(equity: Array<{ time: string; equity: number }>) {
  const points: Array<{ time: string; equity: number }> = [];
  for (const point of equity) {
    const month = point.time.slice(0, 7);
    const last = points.at(-1);
    if (!last || last.time.slice(0, 7) !== month) points.push(point);
    else points[points.length - 1] = point;
  }
  return points;
}

const SERIES_CACHE = "/tmp/semi-ma4-series.json";

type CachedSeries = {
  boardName: string;
  bars: KBar[];
  members: Member[];
  stocks: StockSeries[];
};

function loadSeriesCache(): CachedSeries | null {
  if (!existsSync(SERIES_CACHE)) return null;
  try {
    const cached = JSON.parse(readFileSync(SERIES_CACHE, "utf8")) as CachedSeries;
    if (!cached.bars?.length || !cached.stocks?.length) return null;
    return cached;
  } catch {
    return null;
  }
}

async function main() {
  let boardName = BOARD_NAME;
  let bars: KBar[] = [];
  let members: Member[] = [];
  let stocks: StockSeries[] = [];
  const cached = loadSeriesCache();
  if (cached) {
    boardName = cached.boardName;
    bars = cached.bars;
    members = cached.members;
    stocks = cached.stocks;
    console.log(`cache ${boardName} bars=${bars.length} stocks=${stocks.length} ${bars[0]?.time} → ${bars.at(-1)?.time}`);
  } else {
    console.log("fetching semiconductor index…");
    const board = await fetchBoardBars();
    boardName = board.name;
    bars = board.bars;
    console.log(`index ${boardName} bars=${bars.length} ${bars[0]?.time} → ${bars.at(-1)?.time}`);

    console.log("fetching members…");
    members = await fetchMembers();
    console.log(`members=${members.length}`);

    console.log("fetching constituent dailies…");
    stocks = (
      await mapPool(members, 4, async (member) => {
        try {
          const kline = await fetchStockBars(member.code);
          if (kline.length < 30) {
            console.warn(`short ${member.code} ${member.name} bars=${kline.length}`);
            return null;
          }
          return { code: toTencent(member.code), name: member.name, bars: kline } satisfies StockSeries;
        } catch (error) {
          console.warn(`skip ${member.code} ${member.name}:`, error instanceof Error ? error.message : error);
          return null;
        }
      })
    ).filter((item): item is StockSeries => item != null);
    console.log(`stock series=${stocks.length}`);
    writeFileSync(SERIES_CACHE, JSON.stringify({ boardName, bars, members, stocks }));
  }

  const payload: {
    board: string;
    boardName: string;
    indexFrom: string | undefined;
    indexTo: string | undefined;
    memberCount: number;
    stockCount: number;
    fetchedAt: string;
    results: ReturnType<typeof summarize>[];
  } = {
    board: BOARD,
    boardName: boardName || BOARD_NAME,
    indexFrom: bars[0]?.time,
    indexTo: bars.at(-1)?.time,
    memberCount: members.length,
    stockCount: stocks.length,
    fetchedAt: new Date().toISOString(),
    results: [],
  };

  const jobs: Array<{ entryMode: EntryMode; allCash: boolean; stake: number; sameDayReentry?: boolean }> = [
    { entryMode: "box-first-day", allCash: false, stake: 20_000 },
    { entryMode: "first-on-ma4", allCash: false, stake: 20_000 },
    { entryMode: "in-box-on-ma4", allCash: true, stake: 100_000, sameDayReentry: true },
    { entryMode: "in-box-on-ma4", allCash: true, stake: 100_000, sameDayReentry: false },
  ];
  for (const period of PERIODS) {
    for (const job of jobs) {
      const result = runMa4StandBacktest({
        label: period.label,
        indexBars: bars,
        stocks,
        periodStart: period.start,
        periodEnd: period.end,
        entryMode: job.entryMode,
        stake: job.stake,
        allCash: job.allCash,
        sameDayReentry: job.sameDayReentry,
      });
      payload.results.push(summarize(result));
      console.log(
        [
          period.label,
          job.entryMode,
          job.allCash ? "allCash" : `stake=${job.stake}`,
          job.entryMode === "in-box-on-ma4" ? (job.sameDayReentry ? "sameDay" : "nextDay") : "",
          `boxes=${result.boxes}`,
          `trades=${result.trades.length}`,
          `skipMa4=${result.skippedNoMa4}`,
          `skipStock=${result.skippedNoStock}`,
          `oneDay=${result.skippedOneDay}`,
          `return=${pct(result.returnPct)}`,
          `mdd=${pct(result.maxDrawdownPct)}`,
          `final=${result.finalEquity.toFixed(2)}`,
        ].join("  "),
      );
    }
  }

  const outPath = "/tmp/semi-ma4-backtest.json";
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
