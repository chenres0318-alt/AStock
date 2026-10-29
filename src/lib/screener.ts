import { toTencentCode } from "./codes";
import { listBoardsInTrend, loadBoardMa4Screen } from "./sectorTrendData";
import { collectMa4StandHits, isScreenerShare, type SectorMa4Screen } from "./screenerLogic";
import { mapPool, raceDeadline } from "./pool";
import type { ScreenerHit } from "./types";

const BOARD_CONCURRENCY = 2;
const RESULT_TTL_MS = 2 * 60_000;
const SCAN_MAX_MS = 180_000;
const FIRST_WAIT_MS = 2_000;

function hitReasons(row: ReturnType<typeof collectMa4StandHits>[number]): string[] {
  const reasons: string[] = [];
  if (row.ma4CrossUpMa7) reasons.push(`MA4上叉MA7共${Math.max(row.crossDays, 1)}日`);
  if (row.weekOnMa4) reasons.push(`周K站上MA4共${Math.max(row.weekDays, 1)}周`);
  if (row.monthOnMa4) reasons.push(`月K站上MA4共${Math.max(row.monthDays, 1)}月`);
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
    standDays: row.holdDays,
    dailyDays: row.days,
    crossDays: row.crossDays,
    weekDays: row.weekOnMa4 ? row.weekDays : 0,
    monthDays: row.monthOnMa4 ? row.monthDays : 0,
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
  scanning: boolean;
  timedOut?: boolean;
};

type ScanJob = {
  startedAt: number;
  promise: Promise<StockScreenResult>;
  snapshot: () => StockScreenResult;
};

let job: ScanJob | null = null;
let cachedResult: { value: StockScreenResult; expireAt: number } | null = null;

export async function screenStocks(): Promise<StockScreenResult> {
  if (!job && cachedResult && cachedResult.expireAt > Date.now()) {
    return { ...cachedResult.value, scanning: false };
  }
  const created = !job;
  if (!job) job = startJob();
  if (created) {
    const done = await raceDeadline(job.promise, FIRST_WAIT_MS);
    if (done) return { ...done, scanning: false };
  }
  return job.snapshot();
}

function startJob(): ScanJob {
  const startedAt = Date.now();
  const state = {
    scanned: 0,
    universe: 0,
    liveBoards: 0,
    sectors: [] as SectorMa4Screen[],
    done: false,
  };
  const snapshot = (): StockScreenResult => ({
    scanned: state.scanned,
    universe: state.universe,
    liveBoards: state.liveBoards,
    items: collectMa4StandHits(state.sectors)
      .filter((row) => isScreenerShare(row.code, row.name))
      .map(toHit),
    source: "ths-industry",
    scanning: !state.done,
    timedOut: state.done && state.universe > 0 && state.scanned < state.universe,
  });
  const deadline = startedAt + SCAN_MAX_MS;
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
        if (screen) state.sectors.push(screen);
      } catch {
        // skip board
      } finally {
        state.scanned += 1;
      }
    });
    state.done = true;
    return snapshot();
  })()
    .then((value) => {
      cachedResult = {
        value: { ...value, scanning: false },
        expireAt: Date.now() + (value.timedOut ? 20_000 : RESULT_TTL_MS),
      };
      return value;
    })
    .finally(() => {
      state.done = true;
      if (job?.startedAt === startedAt) job = null;
    });
  return { startedAt, promise, snapshot };
}
