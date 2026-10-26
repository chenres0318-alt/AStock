import { marketOf, toTencentCode } from "./codes";
import { listBoardsInTrend, loadBoardMa4Screen } from "./sectorTrendData";
import { collectMa4StandHits, type SectorMa4Screen } from "./screenerLogic";
import { mapPool } from "./pool";
import type { ScreenerHit } from "./types";

const SCAN_DEADLINE_MS = 100_000;
const BOARD_CONCURRENCY = 2;
const RESULT_TTL_MS = 2 * 60_000;

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

export type StockScreenResult = {
  scanned: number;
  universe: number;
  liveBoards: number;
  items: ScreenerHit[];
  source: string;
  timedOut?: boolean;
};

let running: Promise<StockScreenResult> | null = null;
let cachedResult: { value: StockScreenResult; expireAt: number } | null = null;

export function screenStocks(): Promise<StockScreenResult> {
  if (cachedResult && cachedResult.expireAt > Date.now()) {
    return Promise.resolve(cachedResult.value);
  }
  if (running) return running;
  running = runScreenStocks()
    .then((value) => {
      cachedResult = {
        value,
        expireAt: Date.now() + (value.timedOut ? 60_000 : RESULT_TTL_MS),
      };
      return value;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

async function runScreenStocks(): Promise<StockScreenResult> {
  const deadline = Date.now() + SCAN_DEADLINE_MS;
  const { codes, offMa4 } = await listBoardsInTrend();
  const off = new Set(offMa4);
  const liveOnMa4 = codes.filter((code) => !off.has(code));
  let scanned = 0;
  const sectors: SectorMa4Screen[] = [];

  await mapPool(liveOnMa4, BOARD_CONCURRENCY, async (code) => {
    if (Date.now() > deadline) return;
    try {
      const screen = await loadBoardMa4Screen(code);
      scanned += 1;
      if (screen) sectors.push(screen);
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
    timedOut: Date.now() > deadline && scanned < liveOnMa4.length,
  };
}
