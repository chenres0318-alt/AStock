"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { displaySymbol, isIndexCode, isListedStockCode, priceDigits } from "@/lib/codes";
import { formatClock, formatPct, formatPrice, toneClass } from "@/lib/format";
import { useHoldings } from "@/lib/useHoldings";
import type { HoldingItem, HoldingStatus, Quote, SearchItem } from "@/lib/types";
import AppHeader from "./AppHeader";
import StockWatchPane from "./StockWatchPane";
import { EmptyHint, PanelTitle } from "./ui";

type StatusResponse = {
  items: HoldingStatus[];
  error?: string;
};

function canHoldSearchHit(hit: SearchItem) {
  return isListedStockCode(hit.code) && !isIndexCode(hit.code);
}

function HoldingSearch({
  onPick,
}: {
  onPick: (item: HoldingItem) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const q = keyword.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { items?: SearchItem[]; error?: string };
        setHits((data.items ?? []).filter(canHoldSearchHit));
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [keyword]);

  return (
    <div className="relative border-b border-line px-3 py-2" ref={boxRef}>
      <input
        ref={inputRef}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        placeholder="搜索代码 / 名称加入持仓"
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-mute focus:border-gold/60"
      />
      {open && (keyword.trim() || searching) ? (
        <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-panel-2 scroll-thin">
          {searching ? <div className="px-3 py-2 text-xs text-mute">搜索中…</div> : null}
          {!searching && hits.length === 0 ? <div className="px-3 py-2 text-xs text-mute">没有匹配的股票</div> : null}
          {hits.map((hit) => (
            <button
              key={hit.code}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-panel"
              onClick={() => {
                onPick({ code: hit.code, name: hit.name, sector: null, sectorCode: null });
                setKeyword("");
                setOpen(false);
                setHits([]);
              }}
            >
              <span>
                {hit.name}
                <span className="ml-2 text-xs text-mute">{displaySymbol(hit.code)}</span>
              </span>
              <span className="text-[10px] text-gold">{hit.typeName || "加入"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Holdings() {
  const { items, ready, add, remove, applySectors } = useHoldings();
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const codesKey = items.map((item) => item.code).join(",");
  const [selected, setSelected] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, HoldingStatus>>(new Map());
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    const tick = () => setClock(formatClock());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!items.length) {
      setSelected(null);
      return;
    }
    setSelected((current) => (current && items.some((item) => item.code === current) ? current : items[0].code));
  }, [items, ready]);

  const loadQuotes = useCallback(async () => {
    const list = itemsRef.current;
    if (!list.length) {
      setQuotes(new Map());
      return;
    }
    const res = await fetch(`/api/market/overview?codes=${list.map((item) => item.code).join(",")}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { quotes?: Quote[]; error?: string };
    if (!res.ok) throw new Error(data.error || "行情刷新失败");
    const map = new Map<string, Quote>();
    for (const quote of data.quotes ?? []) map.set(quote.code, quote);
    setQuotes(map);
  }, [codesKey]);

  const loadStatus = useCallback(async () => {
    const list = itemsRef.current;
    if (!list.length) {
      setStatuses(new Map());
      return;
    }
    setStatusLoading(true);
    try {
      const res = await fetch("/api/holdings/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: list }),
        cache: "no-store",
      });
      const data = (await res.json()) as StatusResponse;
      if (!res.ok) throw new Error(data.error || "持仓条件核对失败");
      const map = new Map<string, HoldingStatus>();
      for (const row of data.items ?? []) map.set(row.code, row);
      setStatuses(map);
      applySectors(data.items ?? []);
      setError(null);
    } finally {
      setStatusLoading(false);
    }
  }, [applySectors, codesKey]);

  useEffect(() => {
    if (!ready) return;
    loadQuotes().catch((err) => setError(err instanceof Error ? err.message : "行情刷新失败"));
    loadStatus().catch((err) => setError(err instanceof Error ? err.message : "持仓条件核对失败"));
  }, [ready, loadQuotes, loadStatus]);

  useEffect(() => {
    if (!ready || !auto || !items.length) return;
    let cancelled = false;
    let timer = 0;
    const loop = () => {
      timer = window.setTimeout(() => {
        loadQuotes()
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) loop();
          });
      }, 5000);
    };
    loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, auto, items.length, loadQuotes]);

  const pick = (item: HoldingItem) => {
    add(item);
    setSelected(item.code);
  };

  const selectedItem = items.find((item) => item.code === selected) ?? null;
  const selectedStatus = selected ? statuses.get(selected) : undefined;
  const hint = selectedStatus
    ? {
        label: selectedStatus.label,
        hold: selectedStatus.action === "hold",
        detail: selectedStatus.notes.join(" · "),
      }
    : null;

  const counts = useMemo(() => {
    let hold = 0;
    let exit = 0;
    for (const item of items) {
      const status = statuses.get(item.code);
      if (status?.action === "hold") hold += 1;
      else if (status?.action === "exit") exit += 1;
    }
    return { hold, exit };
  }, [items, statuses]);

  return (
    <div className="flex min-h-dvh w-full flex-col gap-2 px-2 py-2 xl:h-dvh xl:overflow-hidden">
      <AppHeader
        trailing={
          <>
            <span className="num text-xs text-mute">{clock}</span>
            <button
              type="button"
              onClick={() => setAuto((value) => !value)}
              className={`rounded-full px-2.5 py-1 text-xs ${auto ? "bg-gold text-bg" : "bg-panel text-mute"}`}
            >
              {auto ? "自动刷新" : "已暂停"}
            </button>
            <button
              type="button"
              onClick={() => {
                loadQuotes().catch((err) => setError(err instanceof Error ? err.message : "刷新失败"));
                loadStatus().catch((err) => setError(err instanceof Error ? err.message : "核对失败"));
              }}
              className="rounded-full bg-panel px-2.5 py-1 text-xs text-ink ring-1 ring-line"
            >
              立即刷新
            </button>
          </>
        }
      />

      {error ? (
        <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[280px_minmax(0,1fr)]">
        <section className="panel flex min-h-[280px] flex-col overflow-hidden xl:h-full xl:min-h-0">
          <PanelTitle
            title="我的持仓"
            extra={
              <span className="text-[10px] text-mute">
                {items.length} 只
                {statuses.size ? ` · 持仓 ${counts.hold} · 离场 ${counts.exit}` : ""}
                {statusLoading ? " · 核对中" : ""}
              </span>
            }
          />
          <HoldingSearch onPick={pick} />
          <div className="flex-1 overflow-auto scroll-thin">
            {!ready ? <EmptyHint text="读取持仓…" /> : null}
            {ready && items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-mute">
                还没有持仓。上面搜索加入，或去
                <Link href="/screener" className="mx-1 text-gold hover:underline">
                  选股
                </Link>
                页点 + 。
              </div>
            ) : null}
            {items.map((item) => {
              const active = item.code === selected;
              const quote = quotes.get(item.code);
              const status = statuses.get(item.code);
              const hold = status?.action === "hold";
              const sector = status?.sector ?? item.sector;
              return (
                <div
                  key={item.code}
                  className={`flex items-start gap-2 border-b border-line/70 px-3 py-2 ${
                    active ? "bg-panel-2" : "hover:bg-panel-2/60"
                  }`}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(item.code)}>
                    <div className="truncate text-sm">{item.name}</div>
                    <div className="text-[11px] text-mute">
                      {displaySymbol(item.code)}
                      {sector ? ` · ${sector}` : ""}
                    </div>
                    {status ? (
                      <div className={`mt-1 text-xs ${hold ? "text-down" : "text-up"}`}>{status.label}</div>
                    ) : (
                      <div className="mt-1 text-xs text-mute">{statusLoading ? "按选股条件核对…" : "待核对"}</div>
                    )}
                    {status?.notes.length ? (
                      <div className="mt-0.5 text-[11px] leading-4 text-mute">{status.notes.join(" · ")}</div>
                    ) : null}
                  </button>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      <div className={`num text-sm ${toneClass(quote?.pct)}`}>
                        {formatPrice(quote?.price, priceDigits(item.code, item.name))}
                      </div>
                      <div className={`num text-[11px] ${toneClass(quote?.pct)}`}>{formatPct(quote?.pct)}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`移出持仓 ${item.name}`}
                      title="移出持仓"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-panel text-lg leading-none text-mute ring-1 ring-line hover:text-up"
                      onClick={() => {
                        if (selected === item.code) {
                          const next = items.find((row) => row.code !== item.code);
                          setSelected(next?.code ?? null);
                        }
                        remove(item.code);
                      }}
                    >
                      −
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <StockWatchPane
          code={selectedItem?.code ?? null}
          auto={auto}
          hint={hint}
        />
      </div>

      <p className="pb-1 text-center text-[11px] text-mute">
        搜索加入或从选股点 + 。继续持仓 / 需要离场按当前选股条件核对：板块红框、板块指数站上 MA4、个股收盘站上 MA4。仅供看盘学习，不构成投资建议。
      </p>
    </div>
  );
}
