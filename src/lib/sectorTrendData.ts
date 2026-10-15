import { listAllIndustryBoards, listBoardMembers } from "./boards";
import { cached } from "./cache";
import { isTonghuashunIndustry } from "./codes";
import { UpstreamError } from "./http";
import { mapPool } from "./pool";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  listResonantStocks,
  memberGainsInWindow,
  trendCoversLastBar,
  type SectorMemberPath,
  type SectorTrendSegment,
} from "./sectorTrend";
import { fetchTonghuashunSeries } from "./sources/tonghuashun";
import { fetchTencentKline } from "./sources/tencent";
import type { BoardMember, KBar, SectorItem } from "./types";

export type SectorTrendMember = BoardMember & {
  gain: number | null;
};

export type ResonantStockView = {
  code: string;
  name: string;
  gain: number;
};

export type SectorTrendView = SectorTrendSegment & {
  roster: SectorTrendMember[];
  resonant: ResonantStockView[];
};

export type SectorTrendReport = {
  board: SectorItem;
  bars: KBar[];
  trends: SectorTrendView[];
  pct5: number | null;
  memberCount: number;
};

async function memberSeries(members: BoardMember[]): Promise<Array<{ code: string; name: string; bars: KBar[] }>> {
  const rows = await mapPool(members, 5, async (member) => {
    try {
      const bars = await cached(`trend-member:${member.code}:160`, 10 * 60_000, () =>
        fetchTencentKline(member.code, "day", 160),
      );
      if (!bars.length) return null;
      return { code: member.code, name: member.name, bars };
    } catch {
      return null;
    }
  });
  return rows.filter((item): item is { code: string; name: string; bars: KBar[] } => item != null);
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

export async function getSectorTrend(code: string): Promise<SectorTrendReport> {
  const boardCode = code.trim();
  if (!isTonghuashunIndustry(boardCode)) throw new UpstreamError("请从同花顺行业里选择一个板块", 400);
  const [boards, series, members] = await Promise.all([
    listAllIndustryBoards().catch(() => [] as SectorItem[]),
    industrySeries(boardCode),
    listBoardMembers(boardCode, 40, "amount").catch(() => [] as BoardMember[]),
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
  const trends = captureSectorTrends(bars, paths).map((segment) => {
    const gains = new Map(
      memberGainsInWindow(bars, paths, segment.start, segment.end).map((item) => [item.code, item.gain]),
    );
    const roster = members
      .map((item) => ({ ...item, gain: gains.get(item.code) ?? null }))
      .sort((a, b) => (b.gain ?? -999) - (a.gain ?? -999));
    const resonant = listResonantStocks(bars, segment, stocks);
    return { ...segment, roster, resonant };
  });
  const base = bars.length >= 6 ? bars[bars.length - 6] : null;
  const pct5 = last && base && base.close > 0 ? (last.close / base.close - 1) * 100 : null;
  return {
    board,
    bars,
    trends,
    pct5,
    memberCount: members.length,
  };
}

/** 最新一根还落在趋势区间里的行业代码。先用指数价格筛，再对候选做成分股确认。 */
export async function listBoardsInTrend(): Promise<string[]> {
  return cached("boards-in-open-trend", 10 * 60_000, async () => {
    const boards = await listAllIndustryBoards();
    const klines = await mapPool(boards, 4, async (board) => {
      try {
        const series = await industrySeries(board.code);
        return { code: board.code, bars: series.bars };
      } catch {
        return { code: board.code, bars: [] as KBar[] };
      }
    });
    const candidates = klines.filter((item) => indexCouldBeOpen(item.bars));
    const confirmed = await mapPool(candidates, 3, async (item) => {
      try {
        const members = await listBoardMembers(item.code, 40, "amount");
        const paths = toMemberPaths(await memberSeries(members));
        const trends = captureSectorTrends(item.bars, paths);
        return trendCoversLastBar(trends, item.bars.at(-1)?.time) ? item.code : null;
      } catch {
        return null;
      }
    });
    return confirmed.filter((code): code is string => code != null);
  });
}
