import { listAllIndustryBoards, listBoardMembers, listSelectableBoards } from "./boards";
import { cached } from "./cache";
import { isStarShare, isTonghuashunBoard } from "./codes";
import { UpstreamError } from "./http";
import { mapPool } from "./pool";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  listMa4CrossStocks,
  memberGainsInWindow,
  type SectorMemberPath,
  type SectorTrendSegment,
} from "./sectorTrend";
import { fetchTonghuashunSeries } from "./sources/tonghuashun";
import { fetchTencentKline } from "./sources/tencent";
import type { BoardMember, KBar, SectorItem } from "./types";

export type SectorTrendMember = BoardMember & {
  gain: number | null;
};

export type MaCrossStockView = {
  code: string;
  name: string;
  time: string;
  score: number;
  belowMa4: boolean;
};

export type SectorTrendView = SectorTrendSegment & {
  roster: SectorTrendMember[];
  maCrosses: MaCrossStockView[];
};

export type SectorTrendReport = {
  board: SectorItem;
  bars: KBar[];
  trends: SectorTrendView[];
  roster: SectorTrendMember[];
  pct5: number | null;
  memberCount: number;
};

async function memberSeries(
  members: BoardMember[],
): Promise<Array<{ code: string; name: string; bars: KBar[]; price: number | null }>> {
  const rows = await mapPool(members, 5, async (member) => {
    try {
      const bars = await cached(`trend-member:${member.code}:160`, 10 * 60_000, () =>
        fetchTencentKline(member.code, "day", 160),
      );
      if (!bars.length) return null;
      return { code: member.code, name: member.name, bars, price: member.price };
    } catch {
      return null;
    }
  });
  return rows.filter(
    (item): item is { code: string; name: string; bars: KBar[]; price: number | null } => item != null,
  );
}

function toMemberPaths(series: Array<{ code: string; name: string; bars: KBar[] }>): SectorMemberPath[] {
  return series.map((stock) => {
    const closes = new Map<string, number>();
    for (const bar of stock.bars) closes.set(bar.time, bar.close);
    return { code: stock.code, name: stock.name, closes };
  });
}

async function industrySeries(code: string): Promise<{ name: string; bars: KBar[] }> {
  return fetchTonghuashunSeries(code, 160);
}

async function loadMembers(code: string): Promise<BoardMember[]> {
  let last: BoardMember[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      last = await listBoardMembers(code, 40, "amount");
      if (last.length) return last;
    } catch {
      last = [];
    }
  }
  return last;
}

export async function getSectorTrend(code: string): Promise<SectorTrendReport> {
  const boardCode = code.trim();
  if (!isTonghuashunBoard(boardCode)) throw new UpstreamError("请从同花顺行业或概念里选择一个板块", 400);
  const [boards, series, members] = await Promise.all([
    listSelectableBoards().catch(() => [] as SectorItem[]),
    industrySeries(boardCode),
    loadMembers(boardCode),
  ]);
  const bars = series.bars;
  const found = boards.find((item) => item.code === boardCode);
  const last = bars.at(-1);
  const prev = bars.at(-2);
  const dayPct = last && prev && prev.close > 0 ? (last.close / prev.close - 1) * 100 : null;
  const board: SectorItem = {
    code: boardCode,
    name: found?.name || series.name || boardCode,
    pct: dayPct ?? found?.pct ?? null,
    price: last?.close ?? null,
    leader: found?.leader ?? null,
    leaderCode: found?.leaderCode ?? null,
    upCount: found?.upCount ?? null,
    downCount: found?.downCount ?? null,
    source: "ths",
  };
  const stocks = await memberSeries(members);
  const paths = toMemberPaths(stocks);
  const roster = [...members]
    .map((item) => ({ ...item, gain: null as number | null }))
    .sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  const trends = captureSectorTrends(bars, paths).map((segment) => {
    const gains = new Map(
      memberGainsInWindow(bars, paths, segment.start, segment.end).map((item) => [item.code, item.gain]),
    );
    const trendRoster = members
      .map((item) => ({ ...item, gain: gains.get(item.code) ?? null }))
      .sort((a, b) => (b.gain ?? -999) - (a.gain ?? -999));
    const maCrosses = listMa4CrossStocks(
      segment,
      stocks.filter((stock) => !isStarShare(stock.code)),
    );
    return { ...segment, roster: trendRoster, maCrosses };
  });
  const base = bars.length >= 6 ? bars[bars.length - 6] : null;
  const pct5 = last && base && base.close > 0 ? (last.close / base.close - 1) * 100 : null;
  return {
    board,
    bars,
    trends,
    roster,
    pct5,
    memberCount: members.length,
  };
}

/**
 * 最新一根还落在趋势区间里的行业代码。
 * 下拉标红只看指数价格是否还能把红框留到最后一根，避免对全市场成分股再扫一遍把当前板块拖死。
 * 点进某个行业后，仍用成分股做完整捕捉。
 */
export async function listBoardsInTrend(): Promise<string[]> {
  try {
    return await cached("boards-in-open-trend:v4", 10 * 60_000, async () => {
      const boards = await listAllIndustryBoards();
      const klines = await mapPool(boards, 6, async (board) => {
        try {
          const series = await industrySeries(board.code);
          return { code: board.code, bars: series.bars };
        } catch {
          return { code: board.code, bars: [] as KBar[] };
        }
      });
      if (klines.every((item) => item.bars.length < 3)) {
        throw new UpstreamError("板块日线暂时取不到");
      }
      return klines.filter((item) => indexCouldBeOpen(item.bars)).map((item) => item.code);
    });
  } catch {
    return [];
  }
}
