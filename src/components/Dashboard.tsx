"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_WATCHLIST } from "@/lib/codes";
import { formatClock } from "@/lib/format";
import { pollInterval } from "@/lib/market-status";
import { isAbortError, readJson } from "@/lib/readJson";
import { loadWatchlist, saveWatchlist } from "@/lib/storage";
import type { KBar, MarketStatus, Quote, RankItem, SectorItem, TrendPoint, WatchItem } from "@/lib/types";
import AppHeader from "./AppHeader";
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

export default function Dashboard() {
  const searchParams = useSearchParams();
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
  const [trend, setTrend] = useState<{ points: TrendPoint[]; preClose: number | null; priorCloses: number[] }>({
    points: [],
    preClose: null,
    priorCloses: [],
  });
  const [chartLoading, setChartLoading] = useState(false);
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [liveCodes, setLiveCodes] = useState<string[]>([]);
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
    const fromQuery = searchParams.get("code");
    setWatchlist(saved.items);
    setSelected(fromQuery || saved.selected);
    setReady(true);
  }, [searchParams]);

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
  const tradingRef = useRef(trading);
  tradingRef.current = trading;
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    let cancelled = false;
    let timer = 0;
    let inflight = false;

    const loadChart = async (silent: boolean) => {
      if (!silent) setChartLoading(true);
      try {
        if (mode === "trend") {
          const trendReq = readJson<{ points: TrendPoint[]; preClose: number | null; priorCloses?: number[] }>(
            `/api/market/trend?code=${selected}`,
            { signal: ac.signal },
          );
          const dayReq = silent
            ? Promise.resolve({ bars: [] as KBar[] })
            : readJson<{ bars: KBar[] }>(`/api/market/kline?code=${selected}&period=day`, { signal: ac.signal }).catch(
                () => ({ bars: [] as KBar[] }),
              );
          const [data, day] = await Promise.all([trendReq, dayReq]);
          if (cancelled) return;
          setTrend({ points: data.points, preClose: data.preClose, priorCloses: data.priorCloses ?? [] });
          if (day.bars.length) setBars(day.bars);
        } else {
          const data = await readJson<{ bars: KBar[] }>(`/api/market/kline?code=${selected}&period=${mode}`, {
            signal: ac.signal,
          });
          if (cancelled) return;
          setBars(data.bars);
        }
      } finally {
        if (!silent) setChartLoading(false);
      }
    };

    const tick = async (silent: boolean) => {
      if (inflight) return;
      inflight = true;
      try {
        const codes = Array.from(new Set([...watchlist.map((item) => item.code), selected]));
        const data = await readJson<OverviewResponse>(`/api/market/overview?codes=${codes.join(",")}`, {
          signal: ac.signal,
        });
        if (cancelled) return;
        setIndices(data.indices);
        setQuotes(data.quotes);
        setStatus(data.status);
        setError(null);
        await loadChart(silent);
      } catch (err) {
        if (cancelled || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "行情刷新失败");
      } finally {
        inflight = false;
      }
    };

    const loop = async (silent: boolean) => {
      await tick(silent);
      if (cancelled || !auto) return;
      const live = tradingRef.current;
      const delay = pollInterval({
        trading: live,
        phase: live ? "trading" : "closed",
        label: "",
        weekday: true,
        serverTime: "",
      });
      timer = window.setTimeout(() => {
        void loop(true);
      }, delay);
    };

    refreshRef.current = () => {
      void tick(false);
    };
    void loop(false);
    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [ready, auto, selected, mode, watchlist]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    let cancelled = false;
    const load = (attempt: number) => {
      readJson<{ codes: string[] }>("/api/market/sector-trend?list=active", { timeoutMs: 45_000, signal: ac.signal })
        .then((data) => {
          if (!cancelled) setLiveCodes(data.codes ?? []);
        })
        .catch((err) => {
          if (!cancelled && !isAbortError(err) && attempt < 2) window.setTimeout(() => load(attempt + 1), 2000);
        });
    };
    load(0);
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    let cancelled = false;
    let timer = 0;
    const loadAux = async () => {
      try {
        const [sectorRes, up, down, amount, boards] = await Promise.all([
          readJson<{ items: SectorItem[] }>("/api/market/sectors", { signal: ac.signal }),
          readJson<{ items: RankItem[] }>("/api/market/rank?kind=up", { signal: ac.signal }),
          readJson<{ items: RankItem[] }>("/api/market/rank?kind=down", { signal: ac.signal }),
          readJson<{ items: RankItem[] }>("/api/market/rank?kind=amount", { signal: ac.signal }),
          readJson<{ limitUp: RankItem[]; limitDown: RankItem[] }>("/api/market/boards", { signal: ac.signal }),
        ]);
        if (cancelled) return;
        setSectors(sectorRes.items);
        setRankMap({
          up: up.items,
          down: down.items,
          amount: amount.items,
          limitUp: boards.limitUp,
          limitDown: boards.limitDown,
        });
      } catch (err) {
        if (cancelled || isAbortError(err)) return;
      }
    };
    const loop = async () => {
      await loadAux();
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void loop();
      }, 15_000);
    };
    void loop();
    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [ready]);

  const pickStock = (code: string, name: string) => {
    setSelected(code);
    setWatchlist((prev) => (prev.some((item) => item.code === code) ? prev : [{ code, name }, ...prev]));
  };

  return (
    <div className="flex min-h-dvh w-full flex-col gap-2 px-2 py-2 xl:h-dvh xl:overflow-hidden">
      <AppHeader
        trailing={
          <>
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
                refreshRef.current();
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

      <IndexStrip indices={indices} selected={selected} onSelect={setSelected} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[232px_minmax(0,1fr)_240px]">
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
        <div className="flex min-h-[720px] min-w-0 flex-col gap-2 xl:min-h-0">
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
        <div className="flex min-h-0 flex-col gap-2 xl:h-full">
          <SectorList items={sectors} liveCodes={liveCodes} onPick={pickStock} />
          <RankBoard tab={rankTab} onTab={setRankTab} items={rankMap[rankTab]} onPick={pickStock} />
        </div>
      </div>

      <p className="pb-1 text-center text-[11px] text-mute">
        行情来自公开接口，仅供看盘学习，不构成投资建议。
      </p>
    </div>
  );
}
