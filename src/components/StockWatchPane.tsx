"use client";

import { useEffect, useRef, useState } from "react";
import { pollInterval } from "@/lib/market-status";
import { isAbortError, readJson } from "@/lib/readJson";
import type { KBar, Quote, TrendPoint } from "@/lib/types";
import ChartView, { type ChartMode } from "./ChartView";
import QuotePanel from "./QuotePanel";

type OverviewResponse = {
  quotes: Quote[];
  status?: { trading: boolean };
};

export default function StockWatchPane({
  code,
  auto,
  hint,
}: {
  code: string | null;
  auto: boolean;
  hint?: { label: string; hold: boolean; detail?: string } | null;
}) {
  const [mode, setMode] = useState<ChartMode>("trend");
  const [quote, setQuote] = useState<Quote | undefined>();
  const [bars, setBars] = useState<KBar[]>([]);
  const [trend, setTrend] = useState<{ points: TrendPoint[]; preClose: number | null; priorCloses: number[] }>({
    points: [],
    preClose: null,
    priorCloses: [],
  });
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trading, setTrading] = useState(false);
  const tradingRef = useRef(trading);
  tradingRef.current = trading;

  useEffect(() => {
    setQuote(undefined);
    setBars([]);
    setTrend({ points: [], preClose: null, priorCloses: [] });
    setError(null);
  }, [code]);

  useEffect(() => {
    if (!code) return;
    const ac = new AbortController();
    let cancelled = false;
    let timer = 0;
    let inflight = false;

    const loadChart = async (silent: boolean) => {
      if (!silent) setChartLoading(true);
      try {
        if (mode === "trend") {
          const trendReq = readJson<{ points: TrendPoint[]; preClose: number | null; priorCloses?: number[] }>(
            `/api/market/trend?code=${code}`,
            { signal: ac.signal },
          );
          const dayReq = silent
            ? Promise.resolve({ bars: [] as KBar[] })
            : readJson<{ bars: KBar[] }>(`/api/market/kline?code=${code}&period=day`, { signal: ac.signal }).catch(
                () => ({ bars: [] as KBar[] }),
              );
          const [data, day] = await Promise.all([trendReq, dayReq]);
          if (cancelled) return;
          setTrend({ points: data.points, preClose: data.preClose, priorCloses: data.priorCloses ?? [] });
          if (day.bars.length) setBars(day.bars);
        } else {
          const data = await readJson<{ bars: KBar[] }>(`/api/market/kline?code=${code}&period=${mode}`, {
            signal: ac.signal,
          });
          if (cancelled) return;
          setBars(data.bars);
        }
        setError(null);
      } finally {
        if (!silent) setChartLoading(false);
      }
    };

    const tick = async (silent: boolean) => {
      if (inflight) return;
      inflight = true;
      try {
        const data = await readJson<OverviewResponse>(`/api/market/overview?codes=${code}`, { signal: ac.signal });
        if (cancelled) return;
        setQuote(data.quotes.find((item) => item.code === code) ?? data.quotes[0]);
        setTrading(data.status?.trading ?? false);
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

    void loop(false);
    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [code, auto, mode]);

  if (!code) {
    return <div className="panel flex min-h-[560px] flex-1 items-center justify-center text-sm text-mute">选择一只持仓查看看盘图</div>;
  }

  return (
    <div className="flex min-h-[720px] min-w-0 flex-col gap-2 xl:min-h-0">
      {error ? (
        <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div>
      ) : null}
      <QuotePanel quote={quote} hint={hint} />
      <ChartView mode={mode} onMode={setMode} bars={bars} trend={trend} quote={quote} loading={chartLoading} />
    </div>
  );
}
