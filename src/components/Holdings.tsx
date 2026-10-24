"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { displaySymbol, priceDigits } from "@/lib/codes";
import { formatClock, formatPct, formatPrice, toneClass } from "@/lib/format";
import { useHoldings } from "@/lib/useHoldings";
import type { HoldingStatus, Quote } from "@/lib/types";
import AppHeader from "./AppHeader";
import StockWatchPane from "./StockWatchPane";
import { EmptyHint, PanelTitle } from "./ui";

type StatusResponse = {
  items: HoldingStatus[];
  error?: string;
};

export default function Holdings() {
  const { items, ready, remove } = useHoldings();
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
    if (!items.length) {
      setQuotes(new Map());
      return;
    }
    const res = await fetch(`/api/market/overview?codes=${items.map((item) => item.code).join(",")}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { quotes?: Quote[]; error?: string };
    if (!res.ok) throw new Error(data.error || "行情刷新失败");
    const map = new Map<string, Quote>();
    for (const quote of data.quotes ?? []) map.set(quote.code, quote);
    setQuotes(map);
  }, [items]);

  const loadStatus = useCallback(async () => {
    if (!items.length) {
      setStatuses(new Map());
      return;
    }
    setStatusLoading(true);
    try {
      const res = await fetch("/api/holdings/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
        cache: "no-store",
      });
      const data = (await res.json()) as StatusResponse;
      if (!res.ok) throw new Error(data.error || "持仓条件核对失败");
      const map = new Map<string, HoldingStatus>();
      for (const row of data.items ?? []) map.set(row.code, row);
      setStatuses(map);
      setError(null);
    } finally {
      setStatusLoading(false);
    }
  }, [items]);

  useEffect(() => {
    if (!ready) return;
    loadQuotes().catch((err) => setError(err instanceof Error ? err.message : "行情刷新失败"));
    loadStatus().catch((err) => setError(err instanceof Error ? err.message : "持仓条件核对失败"));
  }, [ready, loadQuotes, loadStatus]);

  useEffect(() => {
    if (!ready || !auto || !items.length) return;
    const timer = setInterval(() => {
      loadQuotes().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [ready, auto, items.length, loadQuotes]);

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
          <div className="flex-1 overflow-auto scroll-thin">
            {!ready ? <EmptyHint text="读取持仓…" /> : null}
            {ready && items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-mute">
                还没有持仓。去
                <Link href="/screener" className="mx-1 text-gold hover:underline">
                  选股
                </Link>
                页点 + 加入。
              </div>
            ) : null}
            {items.map((item) => {
              const active = item.code === selected;
              const quote = quotes.get(item.code);
              const status = statuses.get(item.code);
              const hold = status?.action === "hold";
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
                      {item.sector ? ` · ${item.sector}` : ""}
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
        继续持仓 / 需要离场按当前选股条件核对：板块红框、板块指数站上 MA4、个股收盘站上 MA4。仅供看盘学习，不构成投资建议。
      </p>
    </div>
  );
}
