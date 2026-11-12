/** 下拉里标红的板块代码。切板块时只改当前这一只，别把已经确认的抹掉。 */
export function applyBoardLive(codes: readonly string[], board: string, live: boolean): string[] {
  const set = new Set(codes);
  if (live) set.add(board);
  else set.delete(board);
  return [...set];
}

export function mergeLiveCodes(base: readonly string[], extra: readonly string[]): string[] {
  return [...new Set([...base, ...extra])];
}

/**
 * 全量扫描结果覆盖同范围代码，丢掉缓存里过期的红名。
 * 下拉红白以这次指数扫描为准，不因点进某个板块再改算。行业扫描不会把概念抹掉。
 */
export function ingestLiveScan(
  prev: readonly string[],
  incoming: readonly string[],
  _settled: ReadonlySet<string>,
  scope: "industry" | "concept",
): string[] {
  const inScope =
    scope === "concept" ? (code: string) => /^88[5-9]\d{3}$/.test(code) : (code: string) => /^881\d{3}$/.test(code);
  const next = new Set<string>();
  for (const code of prev) {
    if (!inScope(code)) next.add(code);
  }
  for (const code of incoming) next.add(code);
  return [...next];
}

export type TrendScan = { codes: string[]; offMa4: string[] };

export function mergeTrendScan(base: TrendScan, extra: TrendScan): TrendScan {
  return {
    codes: mergeLiveCodes(base.codes, extra.codes),
    offMa4: mergeLiveCodes(base.offMa4, extra.offMa4),
  };
}

export function parseActiveListScope(raw: string | null | undefined): "industry" | "concept" | "all" {
  if (raw === "concept" || raw === "all") return raw;
  return "industry";
}

const STORAGE_KEY = "astock.boards-in-trend.v5";

export function readStoredLiveCodes(): string[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && /^\d{6}$/.test(item));
  } catch {
    return [];
  }
}

export function writeStoredLiveCodes(codes: readonly string[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...codes]));
  } catch {
    // quota / private mode
  }
}
