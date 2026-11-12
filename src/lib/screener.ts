import { bareCode, toTencentCode } from "./codes";
import { applyMa4Crosses, listBoardsInTrend, loadBoardMa4Roster, loadScreenerMemberKlines } from "./sectorTrendData";
import { collectMa4StandHits, dualBoxMemberIds, isScreenerShare, type SectorMa4Screen } from "./screenerLogic";
import { raceDeadline, runDynamicPool } from "./pool";
import type { BoardMember, KBar, ScreenerHit } from "./types";

const BOARD_CONCURRENCY = 6;
const RESULT_TTL_MS = 2 * 60_000;
const SCAN_MAX_MS = 300_000;
const FIRST_WAIT_MS = 2_000;

function hitReasons(): string[] {
  return ["日K站上MA4", "行业红框", "概念红框"];
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
    reasons: hitReasons(),
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
  /** 还在确认哪些板块处于红框，名单会边找边变长。 */
  discovering?: boolean;
  industryLive?: number;
  conceptLive?: number;
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
    industryLive: 0,
    conceptLive: 0,
    sectors: [] as SectorMa4Screen[],
    done: false,
    discovering: true,
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
    discovering: state.discovering,
    industryLive: state.industryLive,
    conceptLive: state.conceptLive,
    timedOut: state.done && (state.discovering || (state.universe > 0 && state.scanned < state.universe)),
  });
  const deadline = startedAt + SCAN_MAX_MS;
  const promise = (async () => {
    const pending: string[] = [];
    const seen = new Set<string>();
    let listingDone = false;
    let waiters: Array<() => void> = [];
    const wake = () => {
      const list = waiters;
      waiters = [];
      for (const resolve of list) resolve();
    };
    const enqueue = (code: string, kind: "industry" | "concept") => {
      if (seen.has(code)) return;
      seen.add(code);
      if (kind === "concept") state.conceptLive += 1;
      else state.industryLive += 1;
      state.liveBoards = seen.size;
      state.universe = seen.size;
      if (Date.now() <= deadline) pending.push(code);
      wake();
    };
    const klines = new Map<string, { code: string; name: string; bars: KBar[]; price: number | null }>();
    const rosterById = () => {
      const map = new Map<string, BoardMember>();
      for (const sector of state.sectors) {
        for (const member of sector.members) {
          const id = bareCode(member.code);
          if (!map.has(id)) {
            map.set(id, {
              code: member.code,
              name: member.name,
              price: member.price,
              pct: member.pct,
              amount: null,
              turnover: member.turnover,
            });
          }
        }
      }
      return map;
    };
    const hydrateDualBox = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const ids = dualBoxMemberIds(state.sectors);
      const roster = rosterById();
      const missing: BoardMember[] = [];
      for (const id of ids) {
        if (klines.has(id)) continue;
        const row = roster.get(id);
        if (row) missing.push(row);
      }
      if (missing.length) {
        const rows = await loadScreenerMemberKlines(missing);
        for (const row of rows) klines.set(bareCode(row.code), row);
      }
      const stocks = [...klines.values()];
      for (let i = 0; i < state.sectors.length; i += 1) {
        state.sectors[i] = applyMa4Crosses(state.sectors[i], stocks);
      }
    };
    let hydrateTail = Promise.resolve();
    let hydrateTimer: ReturnType<typeof setTimeout> | null = null;
    const requestHydrate = (immediate = false) => {
      const run = () => {
        hydrateTimer = null;
        hydrateTail = hydrateTail.then(hydrateDualBox, hydrateDualBox);
        return hydrateTail;
      };
      if (immediate) {
        if (hydrateTimer) {
          clearTimeout(hydrateTimer);
          hydrateTimer = null;
        }
        return run();
      }
      if (hydrateTimer) return hydrateTail;
      hydrateTimer = setTimeout(run, 750);
      return hydrateTail;
    };
    const scanBoard = async (code: string) => {
      if (Date.now() > deadline) return;
      try {
        const screen = await loadBoardMa4Roster(code);
        if (screen) state.sectors.push(screen);
      } catch {
        // skip board
      } finally {
        state.scanned += 1;
        void requestHydrate();
      }
    };
    const listing = Promise.all([
      listBoardsInTrend("industry", (code) => enqueue(code, "industry")),
      listBoardsInTrend("concept", (code) => enqueue(code, "concept")),
    ]).finally(() => {
      listingDone = true;
      state.discovering = false;
      wake();
    });
    await Promise.all([
      listing,
      runDynamicPool(BOARD_CONCURRENCY, {
        pull: () => pending.shift(),
        closed: () => listingDone && pending.length === 0,
        wait: () => {
          if (listingDone || pending.length) return Promise.resolve();
          return new Promise<void>((resolve) => waiters.push(resolve));
        },
        work: scanBoard,
      }),
    ]);
    await requestHydrate(true);
    state.done = true;
    state.discovering = false;
    return snapshot();
  })()
    .then((value) => {
      const emptyDualBox = value.items.length === 0 && (value.conceptLive ?? 0) === 0;
      if (!emptyDualBox) {
        cachedResult = {
          value: { ...value, scanning: false },
          expireAt: Date.now() + (value.timedOut || !value.items.length ? 20_000 : RESULT_TTL_MS),
        };
      }
      return value;
    })
    .finally(() => {
      state.done = true;
      if (job?.startedAt === startedAt) job = null;
    });
  return { startedAt, promise, snapshot };
}
