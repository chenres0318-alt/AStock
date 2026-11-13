import { listAllIndustryBoards, listBoardMembers, listTonghuashunConcepts } from "./boards";
import { bareCode, toTencentCode } from "./codes";
import { loadScreenerMemberKlines } from "./sectorTrendData";
import { collectRibbonHits, isScreenerShare, type ScreenerBoardRef } from "./screenerLogic";
import { raceDeadline, runDynamicPool } from "./pool";
import { SCREENER_BOARD_MEMBER_LIMIT } from "./thsMemberPages";
import type { BoardMember, ScreenerHit } from "./types";

const BOARD_CONCURRENCY = 6;
const RESULT_TTL_MS = 2 * 60_000;
const SCAN_MAX_MS = 300_000;
const FIRST_WAIT_MS = 2_000;

function hitReasons(): string[] {
  return ["日K站上MA4", "MA4>MA7>MA10", "均线向上", "周K MA4>MA7>MA10"];
}

function toHit(row: ReturnType<typeof collectRibbonHits>[number]): ScreenerHit {
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
    sector: row.sector || null,
    sectorCode: row.sectorCode || null,
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

type StockRow = {
  code: string;
  name: string;
  bars: import("./types").KBar[];
  price: number | null;
  pct: number | null;
  turnover: number | null;
  sector: string;
  sectorCode: string;
  boards: ScreenerBoardRef[];
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
    stocks: [] as StockRow[],
    boardsById: new Map<string, ScreenerBoardRef[]>(),
    done: false,
    discovering: true,
  };
  const withBoards = (stock: StockRow): StockRow => ({
    ...stock,
    boards: state.boardsById.get(bareCode(stock.code)) ?? stock.boards,
  });
  const snapshot = (): StockScreenResult => ({
    scanned: state.scanned,
    universe: state.universe,
    liveBoards: state.liveBoards,
    items: collectRibbonHits(state.stocks.map(withBoards)).map(toHit),
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
    const seenBoards = new Set<string>();
    const seenStocks = new Set<string>();
    const boardNames = new Map<string, string>();
    const quotes = new Map<string, BoardMember>();
    const addBoard = (id: string, board: ScreenerBoardRef) => {
      if (!board.code) return;
      const list = state.boardsById.get(id) ?? [];
      if (list.some((item) => item.code === board.code)) return;
      list.push(board);
      state.boardsById.set(id, list);
    };
    let listingDone = false;
    let waiters: Array<() => void> = [];
    const wake = () => {
      const list = waiters;
      waiters = [];
      for (const resolve of list) resolve();
    };
    const enqueue = (code: string) => {
      if (seenBoards.has(code)) return;
      seenBoards.add(code);
      state.liveBoards = seenBoards.size;
      if (Date.now() <= deadline) pending.push(code);
      wake();
    };
    const scanBoard = async (code: string) => {
      if (Date.now() > deadline) return;
      try {
        const members = await listBoardMembers(code, SCREENER_BOARD_MEMBER_LIMIT);
        const sector = boardNames.get(code) ?? "";
        const board = { code, name: sector || code };
        const fresh: BoardMember[] = [];
        for (const member of members) {
          if (!isScreenerShare(member.code, member.name)) continue;
          const id = bareCode(member.code);
          if (!quotes.has(id)) quotes.set(id, member);
          addBoard(id, board);
          if (seenStocks.has(id)) continue;
          seenStocks.add(id);
          state.universe = seenStocks.size;
          fresh.push(member);
        }
        if (fresh.length && Date.now() <= deadline) {
          const rows = await loadScreenerMemberKlines(fresh);
          for (const row of rows) {
            const id = bareCode(row.code);
            const quote = quotes.get(id);
            state.stocks.push({
              code: row.code,
              name: row.name,
              bars: row.bars,
              price: row.price,
              pct: quote?.pct ?? null,
              turnover: quote?.turnover ?? null,
              sector: "",
              sectorCode: "",
              boards: state.boardsById.get(id) ?? [],
            });
            state.scanned += 1;
          }
        }
      } catch {
        // skip board
      }
    };
    const enqueueList = (boards: { code: string; name: string }[], kind: "industry" | "concept") => {
      for (const board of boards) {
        boardNames.set(board.code, board.name);
        enqueue(board.code);
      }
      if (kind === "concept") state.conceptLive = boards.length;
      else state.industryLive = boards.length;
      state.liveBoards = state.industryLive + state.conceptLive;
    };
    const listing = Promise.all([
      listAllIndustryBoards()
        .then((boards) => enqueueList(boards, "industry"))
        .catch(() => enqueueList([], "industry")),
      listTonghuashunConcepts()
        .then((boards) => enqueueList(boards, "concept"))
        .catch(() => enqueueList([], "concept")),
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
    state.done = true;
    state.discovering = false;
    return snapshot();
  })()
    .then((value) => {
      cachedResult = {
        value: { ...value, scanning: false },
        expireAt: Date.now() + (value.timedOut || !value.items.length ? 20_000 : RESULT_TTL_MS),
      };
      return value;
    })
    .finally(() => {
      state.done = true;
      if (job?.startedAt === startedAt) job = null;
    });
  return { startedAt, promise, snapshot };
}
