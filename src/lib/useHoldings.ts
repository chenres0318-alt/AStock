"use client";

import { useCallback, useEffect, useState } from "react";
import { HOLDINGS_EVENT, loadHoldings, saveHoldings } from "@/lib/storage";
import type { HoldingItem } from "@/lib/types";

export function useHoldings() {
  const [items, setItems] = useState<HoldingItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const refresh = () => setItems(loadHoldings());
    refresh();
    setReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "astock.holdings.v1") refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(HOLDINGS_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HOLDINGS_EVENT, refresh);
    };
  }, []);

  const persist = useCallback((next: HoldingItem[]) => {
    setItems(next);
    saveHoldings(next);
  }, []);

  const add = useCallback(
    (item: HoldingItem) => {
      persist(items.some((row) => row.code === item.code) ? items : [item, ...items]);
    },
    [items, persist],
  );

  const remove = useCallback(
    (code: string) => {
      persist(items.filter((row) => row.code !== code));
    },
    [items, persist],
  );

  const has = useCallback((code: string) => items.some((row) => row.code === code), [items]);

  const toggle = useCallback(
    (item: HoldingItem) => {
      if (items.some((row) => row.code === item.code)) {
        persist(items.filter((row) => row.code !== item.code));
        return;
      }
      persist([item, ...items]);
    },
    [items, persist],
  );

  return { items, ready, add, remove, has, toggle };
}
