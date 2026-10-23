/** 下拉里标红的行业代码。切板块时只改当前这一只，别把已经确认的抹掉。 */
export function applyBoardLive(codes: readonly string[], board: string, live: boolean): string[] {
  const set = new Set(codes);
  if (live) set.add(board);
  else set.delete(board);
  return [...set];
}

export function mergeLiveCodes(base: readonly string[], extra: readonly string[]): string[] {
  return [...new Set([...base, ...extra])];
}

const STORAGE_KEY = "astock.boards-in-trend";

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
