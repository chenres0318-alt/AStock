import { DEFAULT_WATCHLIST } from "@/lib/codes";
import type { HoldingItem, WatchItem } from "@/lib/types";

const LIST_KEY = "astock.watchlist.v1";
const SELECTED_KEY = "astock.selected.v1";
const HOLDINGS_KEY = "astock.holdings.v1";
export const HOLDINGS_EVENT = "astock-holdings";

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

export function loadHoldings(): HoldingItem[] {
  try {
    const raw = localStorage.getItem(HOLDINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HoldingItem[];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const items: HoldingItem[] = [];
    for (const item of parsed) {
      if (!item?.code || !item?.name || seen.has(item.code)) continue;
      seen.add(item.code);
      items.push({
        code: item.code,
        name: item.name,
        sector: item.sector ?? null,
        sectorCode: item.sectorCode ?? null,
      });
    }
    return items;
  } catch {
    return [];
  }
}

export function saveHoldings(items: HoldingItem[]) {
  localStorage.setItem(HOLDINGS_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(HOLDINGS_EVENT));
}
