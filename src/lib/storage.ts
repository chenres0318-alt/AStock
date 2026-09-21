import { DEFAULT_WATCHLIST } from "@/lib/codes";
import type { WatchItem } from "@/lib/types";

const LIST_KEY = "astock.watchlist.v1";
const SELECTED_KEY = "astock.selected.v1";

function readList(): WatchItem[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw) as WatchItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_WATCHLIST;
    return parsed.filter((item) => item?.code && item?.name);
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

export function loadWatchlist(): { items: WatchItem[]; selected: string } {
  const items = readList();
  const selected = localStorage.getItem(SELECTED_KEY) || items[0]?.code || "sh600519";
  return { items, selected };
}

export function saveWatchlist(items: WatchItem[], selected: string) {
  localStorage.setItem(LIST_KEY, JSON.stringify(items));
  localStorage.setItem(SELECTED_KEY, selected);
}
