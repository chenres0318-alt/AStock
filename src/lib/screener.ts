import { cached } from "./cache";
import { isHsAShare } from "./codes";
import { analyzeCloses, passesBoardTech, passesStockTech, type TechFlags } from "./indicators";
import { mapPool } from "./pool";
import { listBoardMembers, listIndustryBoards } from "./boards";
import { fetchEastMoneyKline } from "./sources/eastmoney";
import { fetchSinaKline } from "./sources/sina";
import { fetchTencentKline } from "./sources/tencent";
import type { BoardMember, KBar, SectorItem, ScreenerHit } from "./types";

const BOARD_DEADLINE_MS = 95_000;
const STOCK_DEADLINE_MS = 95_000;

function reasonsOf(tech: TechFlags): string[] {
  const rows: string[] = [];
  if (tech.aboveMa5) rows.push("站上五日线");
  if (tech.ma5TurnUp) rows.push("5日均线拐头向上");
  if (tech.deathCross) rows.push("MACD死叉期间");
  if (tech.greenShrinking) rows.push("绿柱缩短");
  if (tech.nearZeroAxis) rows.push("绿柱靠近0轴");
  return rows;
}

function toHit(
  tech: TechFlags,
  meta: {
    code: string;
    name: string;
    boardCode: string;
    boardName: string;
    price?: number;
    pct: number | null;
    turnover: number | null;
  },
): ScreenerHit {
  return {
    code: meta.code,
    name: meta.name,
    boardCode: meta.boardCode,
    boardName: meta.boardName,
    price: meta.price ?? tech.close,
    pct: meta.pct,
    turnover: meta.turnover,
    threeDayPct: tech.threeDayPct,
    ma5: tech.ma5,
    dif: tech.dif,
    dea: tech.dea,
    hist: tech.hist,
    reasons: reasonsOf(tech),
  };
}

async function stockKline(code: string): Promise<KBar[]> {
  try {
    return await cached(`screener-kline:${code}`, 10 * 60_000, async () => {
      try {
        const bars = await fetchTencentKline(code, "day", 90);
        if (bars.length >= 40) return bars;
      } catch {
        // try Sina
      }
      const bars = await fetchSinaKline(code, 90);
      if (bars.length >= 40) return bars;
      throw new Error(`kline unavailable: ${code}`);
    });
  } catch {
    return [];
  }
}

function averageCloses(series: KBar[][]): number[] {
  if (series.length < 2) return [];
  const maps = series.map((bars) => new Map(bars.map((bar) => [bar.time, bar.close])));
  const dates = [...new Set(series.flatMap((bars) => bars.map((bar) => bar.time)))].sort();
  const minCount = Math.min(2, series.length);
  const closes: number[] = [];
  for (const date of dates) {
    const vals: number[] = [];
    for (const map of maps) {
      const value = map.get(date);
      if (value != null) vals.push(value);
    }
    if (vals.length >= minCount) {
      closes.push(vals.reduce((sum, value) => sum + value, 0) / vals.length);
    }
  }
  return closes;
}

async function boardCloses(board: SectorItem, members: BoardMember[]): Promise<number[]> {
  if (board.code.startsWith("BK")) {
    try {
      const bars = await fetchEastMoneyKline(`90.${board.code}`, 90);
      if (bars.length >= 40) return bars.map((bar) => bar.close);
    } catch {
      // fall through to member-average proxy
    }
  }
  const series = (
    await Promise.all(
      members.slice(0, 3).map(async (item) => {
        try {
          return await stockKline(item.code);
        } catch {
          return [] as KBar[];
        }
      }),
    )
  ).filter((bars) => bars.length >= 40);
  return averageCloses(series);
}

async function prefetchKlines(codes: string[], deadline: number, concurrency = 6) {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  await mapPool(unique, concurrency, async (code) => {
    if (Date.now() > deadline) return;
    try {
      await stockKline(code);
    } catch {
      // skip
    }
  });
}

export async function screenBoards(): Promise<{ scanned: number; items: ScreenerHit[]; source: string }> {
  const boards = await listIndustryBoards();
  const deadline = Date.now() + BOARD_DEADLINE_MS;

  const withMembers = await mapPool(boards, 5, async (board) => {
    if (Date.now() > deadline) return { board, members: [] as BoardMember[] };
    try {
      const members = (await listBoardMembers(board.code, 8, "amount")).filter((item) =>
        isHsAShare(item.code, item.name),
      );
      return { board, members };
    } catch {
      return { board, members: [] as BoardMember[] };
    }
  });

  const usable = withMembers.filter((row) => row.members.length >= 2);
  await prefetchKlines(
    usable.flatMap((row) => row.members.slice(0, 3).map((item) => item.code)),
    deadline,
  );

  const items: ScreenerHit[] = [];
  let scanned = 0;
  for (const { board, members } of usable) {
    if (Date.now() > deadline) break;
    try {
      const closes = await boardCloses(board, members);
      if (closes.length < 40) continue;
      scanned += 1;
      const tech = analyzeCloses(closes);
      if (!tech || !passesBoardTech(tech)) continue;
      items.push(
        toHit(tech, {
          code: board.code,
          name: board.name,
          boardCode: board.code,
          boardName: board.name,
          price: tech.close,
          pct: board.pct,
          turnover: null,
        }),
      );
    } catch {
      // skip board
    }
  }

  items.sort((a, b) => Math.abs(a.hist) - Math.abs(b.hist));
  return { scanned, items, source: boards[0]?.source ?? "unknown" };
}

export async function screenStocks(boardCodes: string[]): Promise<{ scanned: number; items: ScreenerHit[] }> {
  const unique = Array.from(new Set(boardCodes.filter(Boolean))).slice(0, 12);
  const catalog = new Map((await listIndustryBoards()).map((item) => [item.code, item.name]));
  const wanted = unique.map((code) => ({
    code,
    name: catalog.get(code) || code,
  }));
  const deadline = Date.now() + STOCK_DEADLINE_MS;
  const grouped: Array<{ board: (typeof wanted)[number]; members: BoardMember[] }> = [];

  for (const board of wanted) {
    if (Date.now() > deadline) break;
    const members = (await listBoardMembers(board.code, 30, "turnover")).filter(
      (item) => isHsAShare(item.code, item.name) && item.turnover != null && item.turnover >= 2,
    );
    grouped.push({ board, members });
  }

  const seen = new Set<string>();
  const candidates: Array<{ member: BoardMember; board: (typeof wanted)[number] }> = [];
  for (const { board, members } of grouped) {
    for (const member of members) {
      if (seen.has(member.code)) continue;
      seen.add(member.code);
      candidates.push({ member, board });
    }
  }

  await prefetchKlines(
    candidates.map((row) => row.member.code),
    deadline,
  );

  const items: ScreenerHit[] = [];
  let scanned = 0;
  for (const { member, board } of candidates) {
    if (Date.now() > deadline) break;
    scanned += 1;
    try {
      const bars = await stockKline(member.code);
      const tech = analyzeCloses(bars.map((bar) => bar.close));
      if (!tech || !passesStockTech(tech, member.turnover)) continue;
      items.push(
        toHit(tech, {
          code: member.code,
          name: member.name,
          boardCode: board.code,
          boardName: board.name,
          price: member.price ?? tech.close,
          pct: member.pct,
          turnover: member.turnover,
        }),
      );
    } catch {
      // skip stock
    }
  }

  items.sort((a, b) => Math.abs(a.hist) - Math.abs(b.hist));
  return { scanned, items };
}
