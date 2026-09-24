#!/usr/bin/env node
/**
 * Backtest the screener buy-point + shared sell on the names that hit
 * the latest scan. Tencent bfq stitched by date, no rescale.
 * T+1 next-open fill. Not investment advice.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { limitPercent } from "../src/lib/codes.ts";
import { analyzeBars, passesBuySetup } from "../src/lib/indicators.ts";
import { shouldExitBuy } from "../src/lib/sell-setup.ts";
import type { KBar } from "../src/lib/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "scripts", ".cache", "bfq");
const OUT = join(ROOT, "src", "data", "buy-point-backtest.json");

const UNIVERSE = [
  { code: "sh603122", name: "合富中国" },
  { code: "sz002297", name: "博云新材" },
  { code: "sz002181", name: "粤传媒" },
  { code: "sz002639", name: "雪人集团" },
] as const;

const ENDS = [
  "2010-06-30",
  "2011-12-31",
  "2013-06-30",
  "2014-12-31",
  "2016-06-30",
  "2017-12-31",
  "2019-06-30",
  "2020-12-31",
  "2022-06-30",
  "2023-12-31",
  "2025-06-30",
  "2026-09-24",
];

const PERIODS: Record<string, { start: string; end: string }> = {
  "2010-2015": { start: "2010-01-01", end: "2015-12-31" },
  "2020-2026": { start: "2020-01-01", end: "2026-09-24" },
};

const COMMISSION = 0.00025;
const STAMP = 0.001;
const SLIP = 0.001;
const CASH0 = 200_000;
const SPLIT_GAP = 0.35;

type Trade = {
  code: string;
  name: string;
  signalDay: string;
  entryDay: string;
  exitDay: string;
  entryPx: number;
  exitPx: number;
  ret: number;
  reason: string;
};

type Coverage = {
  code: string;
  name: string;
  first: string | null;
  last: string | null;
  bars: number;
};

function tradeCost(notional: number, selling: boolean): number {
  let fee = Math.max(5, Math.abs(notional) * COMMISSION);
  if (selling) fee += Math.abs(notional) * STAMP;
  return fee;
}

async function httpJson(url: string): Promise<{ data?: Record<string, { day?: unknown[]; qfqday?: unknown[] }> }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://gu.qq.com/",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ data?: Record<string, { day?: unknown[]; qfqday?: unknown[] }> }>;
}

async function fetchChunk(code: string, end: string): Promise<unknown[][]> {
  mkdirSync(CACHE, { recursive: true });
  const key = join(CACHE, `${code}_${end}.json`);
  if (existsSync(key)) {
    return JSON.parse(readFileSync(key, "utf8")) as unknown[][];
  }
  let last: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const url =
        `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${code},day,2000-01-01,${end},640,bfq`;
      const json = await httpJson(url);
      const node = json.data?.[code] ?? {};
      const rows = (node.day ?? node.qfqday ?? []) as unknown[][];
      writeFileSync(key, JSON.stringify(rows));
      return rows;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw new Error(`${code} ${end}: ${last}`);
}

function parseRows(raw: unknown[][]): Map<string, KBar> {
  const out = new Map<string, KBar>();
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = String(row[0]).slice(0, 10);
    const open = Number(row[1]);
    const close = Number(row[2]);
    const high = Number(row[3]);
    const low = Number(row[4]);
    const volume = Number(row[5]);
    if (!time || !(open > 0) || !(close > 0) || !(high > 0) || !(low > 0)) continue;
    out.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return out;
}

async function loadSymbol(code: string): Promise<KBar[]> {
  const merged = new Map<string, KBar>();
  for (const end of [...ENDS].reverse()) {
    const chunk = parseRows(await fetchChunk(code, end));
    for (const [day, bar] of chunk) {
      if (!merged.has(day)) merged.set(day, bar);
    }
  }
  return [...merged.keys()].sort().map((day) => merged.get(day)!);
}

function isSplitGap(prev: KBar, bar: KBar): boolean {
  if (prev.close <= 0) return false;
  const gap = bar.open / prev.close - 1;
  return gap <= -SPLIT_GAP || gap >= SPLIT_GAP;
}

function maxDrawdown(curve: number[]): number {
  let peak = curve[0] ?? 0;
  let dd = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    if (peak > 0) dd = Math.min(dd, value / peak - 1);
  }
  return dd;
}

function tradeStats(rets: number[]) {
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r < 0);
  const winRate = rets.length ? wins.length / rets.length : null;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;
  let payoff: number | null = null;
  if (!rets.length) payoff = null;
  else if (!losses.length && wins.length) payoff = null;
  else if (!wins.length && losses.length) payoff = 0;
  else if (avgWin != null && avgLoss != null && avgLoss !== 0) payoff = avgWin / Math.abs(avgLoss);
  const expectancy = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
  const sorted = [...rets].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    tradeCount: rets.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    median,
    payoff,
    expectancy,
  };
}

type Position = {
  code: string;
  name: string;
  shares: number;
  entry: number;
  signalIdx: number;
  fillIdx: number;
  signalDay: string;
  entryDay: string;
};

function simulateStock(bars: KBar[], start: string, end: string, code: string, name: string) {
  const limitPct = limitPercent(code, name);
  let cash = CASH0;
  let pos: Position | null = null;
  let pendingBuy: number | null = null;
  let pendingSell: { idx: number; reason: string } | null = null;
  const trades: Trade[] = [];
  const curve: number[] = [];

  const flatten = (i: number, px: number, day: string, reason: string) => {
    if (!pos) return;
    const price = Math.max(px, 0.01);
    const notional = pos.shares * price;
    cash += notional - tradeCost(notional, true);
    trades.push({
      code,
      name,
      signalDay: pos.signalDay,
      entryDay: pos.entryDay,
      exitDay: day,
      entryPx: pos.entry,
      exitPx: price,
      ret: price / pos.entry - 1,
      reason,
    });
    pos = null;
  };

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const inWindow = bar.time >= start && bar.time <= end;
    const prev = i > 0 ? bars[i - 1] : null;
    const split = prev != null && isSplitGap(prev, bar);

    if (split) {
      if (pos) flatten(i, prev.close, prev.time, "除权跳空按前收平仓");
      pendingBuy = null;
      pendingSell = null;
    } else {
      if (pendingSell && i > pendingSell.idx && pos) {
        flatten(i, bar.open * (1 - SLIP), bar.time, pendingSell.reason);
        pendingSell = null;
      }
      if (pendingBuy != null && i > pendingBuy && !pos) {
        const px = bar.open * (1 + SLIP);
        const lot = 100;
        const budget = cash;
        const shares = Math.floor(budget / px / lot) * lot;
        if (shares > 0) {
          const notional = shares * px;
          const fee = tradeCost(notional, false);
          if (cash >= notional + fee) {
            cash -= notional + fee;
            pos = {
              code,
              name,
              shares,
              entry: px,
              signalIdx: pendingBuy,
              fillIdx: i,
              signalDay: bars[pendingBuy].time,
              entryDay: bar.time,
            };
          }
        }
        pendingBuy = null;
      }
    }

    if (inWindow && pos && i > pos.fillIdx && !pendingSell) {
      const check = shouldExitBuy(bars, i, pos.signalIdx, limitPct);
      if (check.exit) pendingSell = { idx: i, reason: check.reason };
    }

    if (inWindow && !pos && pendingBuy == null && pendingSell == null && bar.volume > 0) {
      const tech = analyzeBars(bars.slice(0, i + 1), limitPct);
      if (tech && passesBuySetup(tech)) pendingBuy = i;
    }

    if (bar.time > end && pos) {
      flatten(i, bar.close, bar.time, "区间结束按收盘了结");
      pendingSell = null;
      pendingBuy = null;
    }

    if (inWindow) {
      const equity = cash + (pos ? pos.shares * bar.close : 0);
      curve.push(equity);
    }
    if (bar.time > end) break;
  }

  const windowed = bars.filter((b) => b.time >= start && b.time <= end);
  const lastEquity = curve.at(-1) ?? cash;
  const stats = tradeStats(trades.map((t) => t.ret));
  return {
    code,
    name,
    first: windowed[0]?.time ?? null,
    last: windowed.at(-1)?.time ?? null,
    bars: windowed.length,
    endEquity: lastEquity,
    totalReturn: lastEquity / CASH0 - 1,
    maxDrawdown: curve.length ? maxDrawdown(curve) : 0,
    ...stats,
    closed: trades,
  };
}

function simulatePortfolio(book: Map<string, KBar[]>, start: string, end: string) {
  const loc = new Map<string, Map<string, number>>();
  for (const [code, rows] of book) {
    loc.set(code, new Map(rows.map((bar, i) => [bar.time, i])));
  }
  const days = [
    ...new Set(
      [...book.values()].flatMap((rows) => rows.filter((b) => b.time >= start && b.time <= end).map((b) => b.time)),
    ),
  ].sort();

  let cash = CASH0;
  const positions = new Map<string, Position>();
  const pendingBuy = new Map<string, number>();
  const pendingSell = new Map<string, { idx: number; reason: string }>();
  const trades: Trade[] = [];
  const curve: number[] = [];

  const priceOn = (code: string, day: string, fallback: number) => {
    const rows = book.get(code)!;
    const i = loc.get(code)!.get(day);
    if (i != null) return rows[i].close;
    const prev = rows.filter((b) => b.time <= day).at(-1);
    return prev?.close ?? fallback;
  };

  const flatten = (code: string, px: number, day: string, reason: string) => {
    const pos = positions.get(code);
    if (!pos) return;
    const price = Math.max(px, 0.01);
    const notional = pos.shares * price;
    cash += notional - tradeCost(notional, true);
    trades.push({
      code,
      name: pos.name,
      signalDay: pos.signalDay,
      entryDay: pos.entryDay,
      exitDay: day,
      entryPx: pos.entry,
      exitPx: price,
      ret: price / pos.entry - 1,
      reason,
    });
    positions.delete(code);
  };

  for (const day of days) {
    for (const { code, name } of UNIVERSE) {
      const rows = book.get(code);
      if (!rows?.length) continue;
      const i = loc.get(code)!.get(day);
      if (i == null) continue;
      const bar = rows[i];
      const prev = i > 0 ? rows[i - 1] : null;
      const split = prev != null && isSplitGap(prev, bar);
      const limitPct = limitPercent(code, name);

      if (split) {
        if (positions.has(code)) flatten(code, prev.close, prev.time, "除权跳空按前收平仓");
        pendingBuy.delete(code);
        pendingSell.delete(code);
        continue;
      }

      const sell = pendingSell.get(code);
      if (sell && i > sell.idx && positions.has(code)) {
        flatten(code, bar.open * (1 - SLIP), bar.time, sell.reason);
        pendingSell.delete(code);
      }

      const buyIdx = pendingBuy.get(code);
      if (buyIdx != null && i > buyIdx && !positions.has(code)) {
        const px = bar.open * (1 + SLIP);
        const equity =
          cash +
          [...positions.values()].reduce((sum, pos) => sum + pos.shares * priceOn(pos.code, day, pos.entry), 0);
        const slots = 1 + (UNIVERSE.length - positions.size - 1);
        const budget = Math.min(cash, equity / Math.max(slots, 1));
        const shares = Math.floor(budget / px / 100) * 100;
        if (shares > 0) {
          const notional = shares * px;
          const fee = tradeCost(notional, false);
          if (cash >= notional + fee) {
            cash -= notional + fee;
            positions.set(code, {
              code,
              name,
              shares,
              entry: px,
              signalIdx: buyIdx,
              fillIdx: i,
              signalDay: rows[buyIdx].time,
              entryDay: bar.time,
            });
          }
        }
        pendingBuy.delete(code);
      }

      const pos = positions.get(code);
      if (pos && i > pos.fillIdx && !pendingSell.has(code)) {
        const check = shouldExitBuy(rows, i, pos.signalIdx, limitPct);
        if (check.exit) pendingSell.set(code, { idx: i, reason: check.reason });
      }

      if (!positions.has(code) && !pendingBuy.has(code) && !pendingSell.has(code) && bar.volume > 0) {
        const tech = analyzeBars(rows.slice(0, i + 1), limitPct);
        if (tech && passesBuySetup(tech)) pendingBuy.set(code, i);
      }
    }

    let equity = cash;
    for (const pos of positions.values()) {
      equity += pos.shares * priceOn(pos.code, day, pos.entry);
    }
    curve.push(equity);
  }

  for (const pos of [...positions.values()]) {
    const rows = book.get(pos.code)!;
    const last = rows.filter((b) => b.time <= end).at(-1);
    if (last) flatten(pos.code, last.close, last.time, "区间结束按收盘了结");
  }

  const lastEquity = curve.at(-1) ?? cash;
  const stats = tradeStats(trades.map((t) => t.ret));
  return {
    endEquity: lastEquity,
    totalReturn: lastEquity / CASH0 - 1,
    maxDrawdown: curve.length ? maxDrawdown(curve) : 0,
    ...stats,
    trades,
  };
}

async function main() {
  const book = new Map<string, KBar[]>();
  for (const row of UNIVERSE) {
    process.stderr.write(`load ${row.code} ${row.name}\n`);
    book.set(row.code, await loadSymbol(row.code));
  }

  const periods: Record<string, unknown> = {};
  for (const [label, span] of Object.entries(PERIODS)) {
    const stocks = UNIVERSE.map((row) => simulateStock(book.get(row.code) ?? [], span.start, span.end, row.code, row.name));
    const pooledTrades = stocks.flatMap((s) => s.closed);
    const pooled = tradeStats(pooledTrades.map((t) => t.ret));
    const port = simulatePortfolio(book, span.start, span.end);
    const coverage: Coverage[] = UNIVERSE.map((row) => {
      const rows = (book.get(row.code) ?? []).filter((b) => b.time >= span.start && b.time <= span.end);
      return {
        code: row.code,
        name: row.name,
        first: rows[0]?.time ?? null,
        last: rows.at(-1)?.time ?? null,
        bars: rows.length,
      };
    });
    periods[label] = {
      start: span.start,
      end: span.end,
      coverage,
      portfolio: {
        endEquity: port.endEquity,
        totalReturn: port.totalReturn,
        maxDrawdown: port.maxDrawdown,
        ...tradeStats(port.trades.map((t) => t.ret)),
      },
      pooled: {
        ...pooled,
        maxDrawdown: port.maxDrawdown,
        totalReturn: port.totalReturn,
        endEquity: port.endEquity,
      },
      stocks: stocks.map(({ closed, ...rest }) => ({
        ...rest,
        closed,
      })),
    };
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      cash0: CASH0,
      dataSource: "腾讯日线 bfq，按日期拼接、不复权缩放",
      universe: UNIVERSE,
      assumptions: [
        "买点与看盘选股相同：急跌后二次探底不破、底部分量、MACD绿柱翻头、涨停或大阳打开均线",
        "卖点：买入确认后出现放量长上影，再跌破5日均线，下一交易日开盘卖出；满30个交易日仍未出现则到期离场",
        "A股 T+1，信号日收盘确认，次日开盘成交",
        "佣金万2.5、最低5元，卖出印花税0.1%，滑点0.1%",
        "组合初始20万元，最多同时持有这4只，新开仓按剩余空位均分权益",
        "单票统计各用20万元独立账户，便于看该票本身的交易分布",
        "开盘相对前收跳空超过35%视为除权，按前收平仓，不把拆股跳空算进盈亏",
        "合富中国等上市晚于2010年的标的，在2010–2015自然没有交易",
        "仅供看盘学习，不构成投资建议",
      ],
    },
    periods,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(`wrote ${OUT}\n`);

  const pct = (x: number | null | undefined, digits = 2) =>
    x == null || Number.isNaN(x) ? "--" : `${(x * 100).toFixed(digits)}%`;
  const num = (x: number | null | undefined, digits = 2) =>
    x == null || Number.isNaN(x) ? "--" : x.toFixed(digits);

  for (const [label, raw] of Object.entries(periods)) {
    const block = raw as {
      coverage: Coverage[];
      pooled: {
        tradeCount: number;
        wins: number;
        losses: number;
        winRate: number | null;
        payoff: number | null;
        expectancy: number | null;
        median: number | null;
        maxDrawdown: number;
        totalReturn: number;
      };
      stocks: Array<{
        name: string;
        code: string;
        bars: number;
        first: string | null;
        tradeCount: number;
        winRate: number | null;
        payoff: number | null;
        expectancy: number | null;
        median: number | null;
        maxDrawdown: number;
        totalReturn: number;
      }>;
    };
    console.log(`\n=== ${label} ===`);
    for (const row of block.coverage) {
      console.log(`  ${row.name} ${row.code}  bars=${row.bars}  ${row.first ?? "无数据"} -> ${row.last ?? "--"}`);
    }
    const p = block.pooled;
    console.log(
      `  组合  交易${p.tradeCount}笔(胜${p.wins}/负${p.losses})  胜率${pct(p.winRate)}  最大回撤${pct(p.maxDrawdown)}  盈亏比${num(p.payoff)}  期望值${pct(p.expectancy)}  中位数${pct(p.median)}  区间收益${pct(p.totalReturn)}`,
    );
    for (const s of block.stocks) {
      console.log(
        `  - ${s.name}  交易${s.tradeCount}  胜率${pct(s.winRate)}  回撤${pct(s.maxDrawdown)}  盈亏比${num(s.payoff)}  期望${pct(s.expectancy)}  中位数${pct(s.median)}  收益${pct(s.totalReturn)}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
