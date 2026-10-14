import { listAllIndustryBoards, listBoardMembers } from "./boards";
import { cached } from "./cache";
import { mapPool } from "./pool";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  memberGainsInWindow,
  trendCoversLastBar,
  type SectorMemberPath,
  type SectorTrendSegment,
} from "./sectorTrend";
import { fetchEastMoneyKline } from "./sources/eastmoney";
import { fetchTencentKline } from "./sources/tencent";
import type { BoardMember, KBar, SectorItem } from "./types";

export type SectorTrendMember = BoardMember & {
  gain: number | null;
};

export type SectorTrendView = SectorTrendSegment & {
  roster: SectorTrendMember[];
};

export type SectorTrendReport = {
  board: SectorItem;
  bars: KBar[];
  trends: SectorTrendView[];
  pct5: number | null;
  memberCount: number;
};

async function memberPaths(members: BoardMember[]): Promise<SectorMemberPath[]> {
  const rows = await mapPool(members, 5, async (member) => {
    try {
      const bars = await cached(`trend-member:${member.code}:140`, 10 * 60_000, () =>
        fetchTencentKline(member.code, "day", 140),
      );
      const closes = new Map<string, number>();
      for (const bar of bars) closes.set(bar.time, bar.close);
      if (!closes.size) return null;
      return { code: member.code, name: member.name, closes } satisfies SectorMemberPath;
    } catch {
      return null;
    }
  });
  return rows.filter((item): item is SectorMemberPath => item != null);
}

export async function getSectorTrend(code: string): Promise<SectorTrendReport> {
  const boardCode = code.trim();
  if (!boardCode.startsWith("BK")) throw new Error("请从行业板块里选择一个东财行业");
  const [boards, bars, members] = await Promise.all([
    listAllIndustryBoards(),
    cached(`board-kline:${boardCode}:160`, 10 * 60_000, () => fetchEastMoneyKline(`90.${boardCode}`, 160)),
    listBoardMembers(boardCode, 40, "amount"),
  ]);
  const found = boards.find((item) => item.code === boardCode);
  const board: SectorItem = found ?? {
    code: boardCode,
    name: boardCode,
    pct: null,
    price: bars.at(-1)?.close ?? null,
    leader: null,
    leaderCode: null,
    upCount: null,
    downCount: null,
    source: "bk",
  };
  const paths = await memberPaths(members);
  const trends = captureSectorTrends(bars, paths).map((segment) => {
    const gains = new Map(
      memberGainsInWindow(bars, paths, segment.start, segment.end).map((item) => [item.code, item.gain]),
    );
    const roster = members
      .map((item) => ({ ...item, gain: gains.get(item.code) ?? null }))
      .sort((a, b) => (b.gain ?? -999) - (a.gain ?? -999));
    return { ...segment, roster };
  });
  const last = bars.at(-1);
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
    const klines = await mapPool(boards, 6, async (board) => {
      try {
        const bars = await cached(`board-kline:${board.code}:160`, 10 * 60_000, () =>
          fetchEastMoneyKline(`90.${board.code}`, 160),
        );
        return { code: board.code, bars };
      } catch {
        return { code: board.code, bars: [] as KBar[] };
      }
    });
    const candidates = klines.filter((item) => indexCouldBeOpen(item.bars));
    const confirmed = await mapPool(candidates, 3, async (item) => {
      try {
        const members = await listBoardMembers(item.code, 40, "amount");
        const paths = await memberPaths(members);
        const trends = captureSectorTrends(item.bars, paths);
        return trendCoversLastBar(trends, item.bars.at(-1)?.time) ? item.code : null;
      } catch {
        return null;
      }
    });
    return confirmed.filter((code): code is string => code != null);
  });
}
