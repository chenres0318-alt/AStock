import { mergeTrendScan, type TrendScan } from "./boardLive";
import { listAllIndustryBoards, listBoardMembers, listTonghuashunConcepts } from "./boards";
import { cached } from "./cache";
import { bareCode, isGrowthBoardShare, isStName, isTonghuashunBoard, isTonghuashunConcept } from "./codes";
import { UpstreamError } from "./http";
import { mapPool } from "./pool";
import {
  captureSectorTrends,
  indexCouldBeOpen,
  listMa4CrossStocks,
  listMa4Ma7StandStocks,
  memberGainsInWindow,
  standsOnMa4,
  type SectorMemberPath,
  type SectorTrendSegment,
} from "./sectorTrend";
import { decorateMa4Crosses, trendBoxDays, type SectorMa4Member, type SectorMa4Screen } from "./screenerLogic";
import { alignedLivePrice, shanghaiToday, withLiveClose } from "./thsRealtime";
import { fetchTonghuashunSeries } from "./sources/tonghuashun";
import { fetchTencentKline } from "./sources/tencent";
import { SCREENER_BOARD_MEMBER_LIMIT, TREND_BOARD_MEMBER_LIMIT } from "./thsMemberPages";
import type { BoardMember, KBar, SectorItem } from "./types";

export { SCREENER_BOARD_MEMBER_LIMIT, TREND_BOARD_MEMBER_LIMIT };

type MemberKline = { code: string; name: string; bars: KBar[]; price: number | null };

export type SectorTrendMember = BoardMember & {
  gain: number | null;
};

export type MaCrossStockView = {
  code: string;
  name: string;
  time: string;
  days: number;
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
  onMa4: boolean;
};

async function memberSeries(
  members: BoardMember[],
  count = 160,
  concurrency = 5,
): Promise<Array<{ code: string; name: string; bars: KBar[]; price: number | null }>> {
  const rows = await mapPool(members, concurrency, async (member) => {
    try {
      const history = await cached(`trend-member:${member.code}:${count}`, 10 * 60_000, () =>
        fetchTencentKline(member.code, "day", count),
      );
      if (!history.length) return null;
      const bars = withLiveClose(history, member.price, shanghaiToday());
      const lastClose = bars.at(-1)?.close ?? null;
      return {
        code: member.code,
        name: member.name,
        bars,
        price: alignedLivePrice(member.price, lastClose) ?? lastClose,
      };
    } catch {
      return null;
    }
  });
  return rows.filter(
    (item): item is { code: string; name: string; bars: KBar[]; price: number | null } => item != null,
  );
}

function fillMemberQuotes(
  members: BoardMember[],
  stocks: Array<{ code: string; name: string; bars: KBar[]; price: number | null }>,
): BoardMember[] {
  const byId = new Map(stocks.map((stock) => [bareCode(stock.code), stock]));
  return members.map((item) => {
    const series = byId.get(bareCode(item.code));
    const last = series?.bars.at(-1);
    const prev = series?.bars.at(-2);
    const lastClose = last?.close ?? series?.price ?? null;
    const price = alignedLivePrice(item.price, lastClose) ?? lastClose ?? item.price;
    const keepRosterPct = item.pct != null && alignedLivePrice(item.price, lastClose) != null;
    return {
      ...item,
      price,
      pct: keepRosterPct
        ? item.pct
        : last && prev && prev.close > 0
          ? (last.close / prev.close - 1) * 100
          : item.pct,
    };
  });
}

function toMemberPaths(series: Array<{ code: string; name: string; bars: KBar[] }>): SectorMemberPath[] {
  return series.map((stock) => {
    const closes = new Map<string, number>();
    for (const bar of stock.bars) closes.set(bar.time, bar.close);
    return { code: stock.code, name: stock.name, closes };
  });
}

/** 周K MA7 大约要 7 周日线；多留一些以便红框从更早的起点走到现在。 */
const TREND_BARS = 700;
/** 红框是否还开着只看最近一段，不必把多年日线都拉一遍。 */
const LIVE_BARS = 120;

async function boardSeries(code: string, count: number): Promise<{ name: string; bars: KBar[] }> {
  return cached(`ths-industry-series:${code}:${count}`, 10 * 60_000, () => fetchTonghuashunSeries(code, count));
}

async function industrySeries(code: string): Promise<{ name: string; bars: KBar[] }> {
  return boardSeries(code, TREND_BARS);
}

async function liveSeries(code: string): Promise<{ name: string; bars: KBar[] }> {
  return boardSeries(code, LIVE_BARS);
}

async function loadMembers(code: string, limit = TREND_BOARD_MEMBER_LIMIT): Promise<BoardMember[]> {
  let last: BoardMember[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      last = await listBoardMembers(code, limit, "amount");
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
  return cached(
    `sector-trend-report:v13:${boardCode}`,
    10 * 60_000,
    () => loadSectorTrend(boardCode),
    (report) => report.memberCount >= 5 || report.trends.length > 0,
  );
}

function toScreenMembers(rows: BoardMember[]): SectorMa4Member[] {
  return rows.map((item) => ({
    code: item.code,
    name: item.name,
    price: item.price,
    pct: item.pct,
    turnover: item.turnover,
  }));
}

function emptyBoardScreen(
  code: string,
  name: string,
  onMa4: boolean,
  lastTime: string | undefined,
): SectorMa4Screen {
  return {
    code,
    name,
    onMa4,
    lastTime,
    openTrend: null,
    crosses: [],
    members: [],
  };
}

/** 选股用：红框还开着时先给出完整成分股名单，日/周均线稍后再补。 */
export async function loadBoardMa4Roster(code: string): Promise<SectorMa4Screen | null> {
  const boardCode = code.trim();
  if (!isTonghuashunBoard(boardCode)) return null;
  const series = await liveSeries(boardCode);
  const bars = series.bars;
  if (bars.length < 4) return null;
  const lastTime = bars.at(-1)?.time;
  const onMa4 = standsOnMa4(bars);
  const name = series.name || boardCode;
  if (!lastTime || !indexCouldBeOpen(bars)) {
    return emptyBoardScreen(boardCode, name, onMa4, lastTime);
  }
  const trends = captureSectorTrends(bars, []);
  const open = trends.find((trend) => trend.status === "open" && trend.end === lastTime) ?? null;
  if (!open) {
    return emptyBoardScreen(boardCode, name, onMa4, lastTime);
  }
  const members = await loadMembers(boardCode, SCREENER_BOARD_MEMBER_LIMIT);
  if (members.length < 5) return null;
  return {
    code: boardCode,
    name,
    onMa4,
    lastTime,
    openTrend: { start: open.start, end: open.end, status: open.status },
    boxDays: trendBoxDays(open.start, open.end, bars),
    crosses: [],
    members: toScreenMembers(members),
  };
}

function prepareScreenerStocks(stocks: MemberKline[]): MemberKline[] {
  const asOf = shanghaiToday();
  return stocks.map((stock) => {
    const bars = withLiveClose(stock.bars, stock.price, asOf);
    const lastClose = bars.at(-1)?.close ?? null;
    return {
      ...stock,
      bars,
      price: alignedLivePrice(stock.price, lastClose) ?? lastClose,
    };
  });
}

export function applyMa4Crosses(screen: SectorMa4Screen, stocks: MemberKline[]): SectorMa4Screen {
  const memberIds = new Set(screen.members.map((item) => bareCode(item.code)));
  const inBoard = prepareScreenerStocks(stocks.filter((stock) => memberIds.has(bareCode(stock.code))));
  if (!screen.openTrend || !inBoard.length) return { ...screen, crosses: [] };
  const eligible = inBoard.filter((stock) => !isGrowthBoardShare(stock.code) && !isStName(stock.name));
  const crosses = decorateMa4Crosses(listMa4Ma7StandStocks(screen.openTrend, eligible), inBoard);
  const quoted = fillMemberQuotes(
    screen.members.map((item) => ({ ...item, amount: null })),
    inBoard,
  );
  return {
    ...screen,
    crosses,
    members: toScreenMembers(quoted),
  };
}

export async function loadScreenerMemberKlines(members: BoardMember[]): Promise<MemberKline[]> {
  return memberSeries(members, 80, 8);
}

/** 选股用：只要红框还开着，就扫成分股日/周 MA4+MA7，不要求指数当天还站上 MA4。 */
export async function loadBoardMa4Screen(code: string): Promise<SectorMa4Screen | null> {
  const roster = await loadBoardMa4Roster(code);
  if (!roster?.openTrend || roster.members.length < 5) return roster;
  const stocks = await memberSeries(
    roster.members.map((item) => ({ ...item, amount: null })),
    80,
    6,
  );
  if (stocks.length < 5) return roster;
  return applyMa4Crosses(roster, stocks);
}

async function loadSectorTrend(boardCode: string): Promise<SectorTrendReport> {
  const [series, seededMembers] = await Promise.all([
    industrySeries(boardCode),
    loadMembers(boardCode),
  ]);
  let members = seededMembers;
  if (members.length < 5) members = await loadMembers(boardCode);
  const bars = series.bars;
  const last = bars.at(-1);
  const prev = bars.at(-2);
  const dayPct = last && prev && prev.close > 0 ? (last.close / prev.close - 1) * 100 : null;
  const board: SectorItem = {
    code: boardCode,
    name: series.name || boardCode,
    pct: dayPct,
    price: last?.close ?? null,
    leader: members[0]?.name ?? null,
    leaderCode: members[0]?.code ?? null,
    upCount: null,
    downCount: null,
    source: "ths",
  };
  const stocks = await memberSeries(members, 80, 6);
  const quoted = fillMemberQuotes(members, stocks);
  const paths = toMemberPaths(stocks);
  const roster = quoted.map((item) => ({ ...item, gain: null as number | null }));
  const trends = captureSectorTrends(bars, paths).map((segment) => {
    const gains = new Map(
      memberGainsInWindow(bars, paths, segment.start, segment.end).map((item) => [item.code, item.gain]),
    );
    const trendRoster = quoted
      .map((item) => ({ ...item, gain: gains.get(item.code) ?? null }))
      .sort((a, b) => (b.gain ?? -999) - (a.gain ?? -999));
    const maCrosses = listMa4CrossStocks(
      segment,
      stocks.filter((stock) => !isGrowthBoardShare(stock.code)),
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
    onMa4: standsOnMa4(bars, board.price),
  };
}

async function scanOpenTrend(
  boards: SectorItem[],
  concurrency: number,
  onLive?: (code: string) => void,
): Promise<TrendScan> {
  const klines = await mapPool(boards, concurrency, async (board) => {
    try {
      const series = await liveSeries(board.code);
      const row = { code: board.code, bars: series.bars };
      if (indexCouldBeOpen(row.bars)) onLive?.(board.code);
      return row;
    } catch {
      return { code: board.code, bars: [] as KBar[] };
    }
  });
  if (boards.length && klines.every((item) => item.bars.length < 3)) {
    throw new UpstreamError("板块日线暂时取不到");
  }
  const live = klines.filter((item) => indexCouldBeOpen(item.bars));
  return {
    codes: live.map((item) => item.code),
    offMa4: live.filter((item) => !standsOnMa4(item.bars)).map((item) => item.code),
  };
}

/**
 * 最新一根还落在趋势区间里的板块代码。
 * 下拉标红只看指数日 K MA4/MA7、月 K MA4 能不能把红框留到最后一根，避免对全市场成分股再扫一遍把当前板块拖死。
 * 选股扫行业和概念。板块页一进就扫指数红框给下拉标红，不等点进某个板块；点进去只补成分股龙头，不再改红白。
 */
export async function listBoardsInTrend(
  scope: "industry" | "concept" | "all" = "industry",
  onLive?: (code: string) => void,
): Promise<TrendScan> {
  try {
    if (scope === "all") {
      const [industry, concept] = await Promise.all([
        listBoardsInTrend("industry", onLive),
        listBoardsInTrend("concept", onLive),
      ]);
      return mergeTrendScan(industry, concept);
    }
    if (scope === "concept") {
      return await loadTrendScan("boards-in-open-trend:concept:v11", onLive, async (emit) => {
        const boards = await listTonghuashunConcepts().catch(() => [] as SectorItem[]);
        if (!boards.length) return { codes: [] as string[], offMa4: [] as string[] };
        return scanOpenTrend(boards, 10, emit);
      });
    }
    return await loadTrendScan("boards-in-open-trend:v15", onLive, async (emit) => {
      const boards = await listAllIndustryBoards();
      return scanOpenTrend(boards, 8, emit);
    });
  } catch {
    return { codes: [], offMa4: [] };
  }
}

/** 缓存未命中时边判红框边回调；命中时把已有名单一次交给回调。 */
async function loadTrendScan(
  key: string,
  onLive: ((code: string) => void) | undefined,
  loader: (emit?: (code: string) => void) => Promise<TrendScan>,
): Promise<TrendScan> {
  let streamed = false;
  const scan = await cached(
    key,
    10 * 60_000,
    async () => {
      streamed = true;
      return loader(onLive);
    },
    (value) => value.codes.length > 0,
  );
  if (!streamed) scan.codes.forEach((code) => onLive?.(code));
  return scan;
}
