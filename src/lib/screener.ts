import { marketOf, toTencentCode } from "./codes";
import { getSectorTrend, listBoardsInTrend } from "./sectorTrendData";
import { collectMa4StandHits, type SectorMa4Screen } from "./screenerLogic";
import { mapPool } from "./pool";
import type { ScreenerHit } from "./types";

const SCAN_DEADLINE_MS = 150_000;
const BOARD_CONCURRENCY = 3;

function toHit(row: ReturnType<typeof collectMa4StandHits>[number]): ScreenerHit {
  const code = toTencentCode(row.code);
  return {
    code,
    name: row.name,
    price: row.price ?? 0,
    pct: row.pct,
    turnover: row.turnover,
    amplitudePct: null,
    ma4: 0,
    ma7: 0,
    ma5: 0,
    dif: 0,
    dea: 0,
    hist: 0,
    standDays: row.days,
    reasons: [`站上MA4共${row.days}日`, "板块红框", "板块指数站上MA4"],
    sector: row.sector,
    sectorCode: row.sectorCode,
  };
}

export async function screenStocks(): Promise<{
  scanned: number;
  universe: number;
  liveBoards: number;
  items: ScreenerHit[];
  source: string;
}> {
  const { codes, offMa4 } = await listBoardsInTrend();
  const off = new Set(offMa4);
  const liveOnMa4 = codes.filter((code) => !off.has(code));
  const deadline = Date.now() + SCAN_DEADLINE_MS;
  let scanned = 0;
  const sectors: SectorMa4Screen[] = [];

  await mapPool(liveOnMa4, BOARD_CONCURRENCY, async (code) => {
    if (Date.now() > deadline) return;
    try {
      const report = await getSectorTrend(code);
      scanned += 1;
      const lastTime = report.bars.at(-1)?.time;
      const open = report.trends.find((trend) => trend.status === "open" && trend.end === lastTime) ?? null;
      sectors.push({
        code: report.board.code,
        name: report.board.name,
        onMa4: report.onMa4,
        lastTime,
        openTrend: open ? { start: open.start, end: open.end, status: open.status } : null,
        crosses: open?.maCrosses ?? [],
        members: report.roster.map((item) => ({
          code: item.code,
          name: item.name,
          price: item.price,
          pct: item.pct,
          turnover: item.turnover,
        })),
      });
    } catch {
      // skip board
    }
  });

  return {
    scanned,
    universe: liveOnMa4.length,
    liveBoards: codes.length,
    items: collectMa4StandHits(sectors)
      .filter((row) => marketOf(row.code) !== "BJ")
      .map(toHit),
    source: "ths-industry",
  };
}
