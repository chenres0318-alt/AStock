import { toTencentCode } from "./codes";
import { listBoardsInTrend, loadBoardMa4Screen } from "./sectorTrendData";
import { collectMa4StandHits, isScreenerShare, type SectorMa4Screen } from "./screenerLogic";
import { mapPool, raceDeadline } from "./pool";
import type { ScreenerHit } from "./types";

const BOARD_CONCURRENCY = 4;
const RESULT_TTL_MS = 2 * 60_000;
const SCAN_MAX_MS = 300_000;
const FIRST_WAIT_MS = 2_000;

function hitReasons(row: ReturnType<typeof collectMa4StandHits>[number]): string[] {
  const reasons: string[] = ["日K站上MA4"];
  if (row.ma4CrossUpMa7) reasons.push("MA4上叉MA7");
  if (row.weekOnMa4) reasons.push("周K站上MA4");
  if (row.monthOnMa4) reasons.push("月K站上MA4");
  reasons.push("板块红框", "板块指数站上MA4");
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
    reasons: hitReasons(row),
    sector: row.sector,
    sectorCode: row.sectorCode,
    boards: row.boards,
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
    source: "ths-board",
    scanning: !state.done,
    timedOut: state.done && state.universe > 0 && state.scanned < state.universe,
  });
  const deadline = startedAt + SCAN_MAX_MS;
  const promise = (async () => {
    const liveOnMa4 = (scan: { codes: string[]; offMa4: string[] }) => {
      const off = new Set(scan.offMa4);
      return scan.codes.filter((code) => !off.has(code));
    };
    const industry = await listBoardsInTrend("industry");
    const concept = await listBoardsInTrend("concept");
    const industryLive = liveOnMa4(industry);
    const conceptLive = liveOnMa4(concept);
    state.universe = industryLive.length + conceptLive.length;
    state.liveBoards = industry.codes.length + concept.codes.length;
    const scanBoard = async (code: string) => {
      if (Date.now() > deadline) return;
      try {
        const screen = await loadBoardMa4Screen(code);
        if (screen) state.sectors.push(screen);
      } catch {
        // skip board
      } finally {
        state.scanned += 1;
      }
    };
    await mapPool(industryLive, BOARD_CONCURRENCY, scanBoard);
    await mapPool(conceptLive, BOARD_CONCURRENCY, scanBoard);
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
