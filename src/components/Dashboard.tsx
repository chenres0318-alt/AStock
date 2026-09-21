"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/codes";
import { formatClock } from "@/lib/format";
import { pollInterval } from "@/lib/market-status";
import { loadWatchlist, saveWatchlist } from "@/lib/storage";
import type { KBar, MarketStatus, Quote, RankItem, SectorItem, TrendPoint, WatchItem } from "@/lib/types";
import ChartView, { type ChartMode } from "./ChartView";
import IndexStrip from "./IndexStrip";
import QuotePanel from "./QuotePanel";
import RankBoard, { type RankTab } from "./RankBoard";
import SectorList from "./SectorList";
import WatchPanel from "./WatchPanel";

type OverviewResponse = {
  status: MarketStatus;
  indices: Quote[];
  quotes: Quote[];
  error?: string;
};

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

export default function Dashboard() {
  const [watchlist, setWatchlist] = useState<WatchItem[]>(DEFAULT_WATCHLIST);
  const [selected, setSelected] = useState("sh600519");
  const [indices, setIndices] = useState<Quote[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [clock, setClock] = useState("");
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChartMode>("trend");
  const [bars, setBars] = useState<KBar[]>([]);
  const [trend, setTrend] = useState<{ points: TrendPoint[]; preClose: number | null }>({
    points: [],
    preClose: null,
  });
  const [chartLoading, setChartLoading] = useState(false);
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [rankTab, setRankTab] = useState<RankTab>("up");
  const [rankMap, setRankMap] = useState<Record<RankTab, RankItem[]>>({
    up: [],
    down: [],
    amount: [],
    limitUp: [],
    limitDown: [],
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = loadWatchlist();
    setWatchlist(saved.items);
    setSelected(saved.selected);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveWatchlist(watchlist, selected);
  }, [watchlist, selected, ready]);

  useEffect(() => {
    const tick = () => setClock(formatClock());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const quoteMap = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const item of indices) map.set(item.code, item);
    for (const item of quotes) map.set(item.code, item);
    return map;
  }, [indices, quotes]);

  const current = quoteMap.get(selected);
  const trading = status?.trading ?? false;

  const loadOverview = useCallback(async () => {
    const codes = Array.from(new Set([...watchlist.map((item) => item.code), selected]));
    const data = await readJson<OverviewResponse>(`/api/market/overview?codes=${codes.join(",")}`);
    setIndices(data.indices);
    setQuotes(data.quotes);
    setStatus(data.status);
    setError(null);
  }, [watchlist, selected]);

  const loadChart = useCallback(async (silent = false) => {
    if (!silent) setChartLoading(true);
    try {
      if (mode === "trend") {
        const data = await readJson<{ points: TrendPoint[]; preClose: number | null }>(
          `/api/market/trend?code=${selected}`,
        );
        setTrend({ points: data.points, preClose: data.preClose });
      } else {
        const data = await readJson<{ bars: KBar[] }>(`/api/market/kline?code=${selected}&period=${mode}`);
        setBars(data.bars);
      }
    } finally {
      if (!silent) setChartLoading(false);
    }
  }, [mode, selected]);

  const loadAux = useCallback(async () => {
    const [sectorRes, up, down, amount, boards] = await Promise.all([
      readJson<{ items: SectorItem[] }>("/api/market/sectors"),
      readJson<{ items: RankItem[] }>("/api/market/rank?kind=up"),
      readJson<{ items: RankItem[] }>("/api/market/rank?kind=down"),
      readJson<{ items: RankItem[] }>("/api/market/rank?kind=amount"),
      readJson<{ limitUp: RankItem[]; limitDown: RankItem[] }>("/api/market/boards"),
    ]);
    setSectors(sectorRes.items);
    setRankMap({
      up: up.items,
      down: down.items,
      amount: amount.items,
      limitUp: boards.limitUp,
      limitDown: boards.limitDown,
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await loadOverview();
        await loadChart(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "行情刷新失败");
      }
    };
    tick();
    if (!auto) return;
    const delay = pollInterval({
      trading,
      phase: trading ? "trading" : "closed",
      label: "",
      weekday: true,
      serverTime: "",
    });
    const timer = setInterval(tick, delay);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ready, auto, loadOverview, loadChart, trading]);

  useEffect(() => {
    if (!ready) return;
    loadChart().catch((err) => setError(err instanceof Error ? err.message : "K线加载失败"));
  }, [ready, loadChart]);

  useEffect(() => {
    if (!ready) return;
    loadAux().catch(() => undefined);
    const timer = setInterval(() => {
      loadAux().catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [ready, loadAux]);

  const pickStock = (code: string, name: string) => {
    setSelected(code);
    setWatchlist((prev) => (prev.some((item) => item.code === code) ? prev : [{ code, name }, ...prev]));
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-end gap-0.5 rounded-lg bg-panel px-1.5 py-1 ring-1 ring-line">
            <span className="h-5 w-1.5 rounded-sm bg-up" />
            <span className="h-3 w-1.5 rounded-sm bg-gold" />
            <span className="h-4 w-1.5 rounded-sm bg-down" />
          </div>
          <div>
            <div className="text-lg font-medium leading-tight">
              AStock <span className="text-gold">看盘</span>
            </div>
            <div className="text-[11px] text-mute">沪深京实时行情 · 红涨绿跌</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={`rounded-full px-2.5 py-1 text-xs ${
              status?.trading ? "bg-up/15 text-up" : "bg-panel text-mute"
            }`}
          >
            {status?.label ?? "连接中"}
          </span>
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
              loadOverview().catch((err) => setError(err instanceof Error ? err.message : "刷新失败"));
              loadChart().catch(() => undefined);
              loadAux().catch(() => undefined);
            }}
            className="rounded-full bg-panel px-2.5 py-1 text-xs text-ink ring-1 ring-line"
          >
            立即刷新
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div>
      ) : null}

      <IndexStrip indices={indices} selected={selected} onSelect={setSelected} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        <WatchPanel
          items={watchlist}
          quotes={quoteMap}
          selected={selected}
          onSelect={setSelected}
          onAdd={(item) => pickStock(item.code, item.name)}
          onRemove={(code) => {
            setWatchlist((prev) => {
              const next = prev.filter((item) => item.code !== code);
              if (code === selected && next[0]) setSelected(next[0].code);
              return next;
            });
          }}
        />
        <div className="flex min-h-0 flex-col gap-3">
          <QuotePanel quote={current} />
          <ChartView
            mode={mode}
            onMode={setMode}
            bars={bars}
            trend={trend}
            quote={current}
            loading={chartLoading}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <SectorList items={sectors} onPick={pickStock} />
          <RankBoard tab={rankTab} onTab={setRankTab} items={rankMap[rankTab]} onPick={pickStock} />
        </div>
      </div>

      <p className="pb-1 text-center text-[11px] text-mute">
        行情来自公开接口，仅供看盘学习，不构成投资建议。
      </p>
    </div>
  );
}
