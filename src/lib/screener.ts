import { toTencentCode } from "./codes";
import { listBoardsInTrend, loadBoardMa4Screen } from "./sectorTrendData";
import { collectMa4StandHits, isScreenerShare, type SectorMa4Screen } from "./screenerLogic";
import { mapPool, raceDeadline } from "./pool";
import type { ScreenerHit } from "./types";

/** 预览代理常在 60s 掐连接，必须在那之前把 JSON 送回去。 */
const SCAN_DEADLINE_MS = 42_000;
const BOARD_CONCURRENCY = 2;
const RESULT_TTL_MS = 2 * 60_000;
const PARTIAL_TTL_MS = 30_000;

function hitReasons(row: ReturnType<typeof collectMa4StandHits>[number]): string[] {
  const reasons: string[] = [];
  if (row.ma4CrossUpMa7) reasons.push("MA4上叉MA7");
  if (row.weekOnMa4) reasons.push("周K站上MA4");
  reasons.push(`站上MA4共${row.days}日`, "板块红框", "板块指数站上MA4");
  return reasons;
}

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
    reasons: hitReasons(row),
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

type ScanJob = {
  startedAt: number;
  promise: Promise<StockScreenResult>;
  snapshot: (timedOut: boolean) => StockScreenResult;
};

let job: ScanJob | null = null;
let cachedResult: { value: StockScreenResult; expireAt: number } | null = null;

export async function screenStocks(): Promise<StockScreenResult> {
  if (!job && cachedResult && cachedResult.expireAt > Date.now()) {
    return cachedResult.value;
  }
  if (!job) job = startJob();
  const current = job;
  const waitMs = Math.max(0, current.startedAt + SCAN_DEADLINE_MS - Date.now());
  let finished = await raceDeadline(current.promise, waitMs);
  if (finished) return finished;
  let partial = current.snapshot(true);
  if (!partial.scanned) {
    finished = await raceDeadline(current.promise, 8_000);
    if (finished) return finished;
    partial = current.snapshot(true);
  }
  if (partial.items.length) {
    cachedResult = { value: partial, expireAt: Date.now() + PARTIAL_TTL_MS };
  }
  return partial;
}

function startJob(): ScanJob {
  const startedAt = Date.now();
  const state = {
    scanned: 0,
    universe: 0,
    liveBoards: 0,
    sectors: [] as SectorMa4Screen[],
  };
  const snapshot = (timedOut: boolean): StockScreenResult => ({
    scanned: state.scanned,
    universe: state.universe,
    liveBoards: state.liveBoards,
    items: collectMa4StandHits(state.sectors)
      .filter((row) => isScreenerShare(row.code, row.name))
      .map(toHit),
    source: "ths-industry",
    timedOut,
  });
  const deadline = startedAt + SCAN_DEADLINE_MS;
  const promise = (async () => {
    const { codes, offMa4 } = await listBoardsInTrend();
    const off = new Set(offMa4);
    const liveOnMa4 = codes.filter((code) => !off.has(code));
    state.universe = liveOnMa4.length;
    state.liveBoards = codes.length;
    await mapPool(liveOnMa4, BOARD_CONCURRENCY, async (code) => {
      if (Date.now() > deadline) return;
      try {
        const screen = await loadBoardMa4Screen(code);
        state.scanned += 1;
        if (screen) state.sectors.push(screen);
      } catch {
        // skip board
      }
    });
    return snapshot(Date.now() > deadline && state.scanned < liveOnMa4.length);
  })()
    .then((value) => {
      cachedResult = {
        value,
        expireAt: Date.now() + (value.timedOut ? PARTIAL_TTL_MS : RESULT_TTL_MS),
      };
      return value;
    })
    .finally(() => {
      if (job?.startedAt === startedAt) job = null;
    });
  return { startedAt, promise, snapshot };
}
