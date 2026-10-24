"use client";

import { useCallback, useEffect, useState } from "react";
import { pollInterval } from "@/lib/market-status";
import type { KBar, Quote, TrendPoint } from "@/lib/types";
import ChartView, { type ChartMode } from "./ChartView";
import QuotePanel from "./QuotePanel";

type OverviewResponse = {
  quotes: Quote[];
  status?: { trading: boolean };
};

async function readJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

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

  const loadQuote = useCallback(async () => {
    if (!code) {
      setQuote(undefined);
      return;
    }
    const data = await readJson<OverviewResponse>(`/api/market/overview?codes=${code}`);
    setQuote(data.quotes.find((item) => item.code === code) ?? data.quotes[0]);
    setTrading(data.status?.trading ?? false);
  }, [code]);

  const loadChart = useCallback(
    async (silent = false) => {
      if (!code) {
        setBars([]);
        setTrend({ points: [], preClose: null, priorCloses: [] });
        return;
      }
      if (!silent) setChartLoading(true);
      try {
        if (mode === "trend") {
          const [data, day] = await Promise.all([
            readJson<{ points: TrendPoint[]; preClose: number | null; priorCloses?: number[] }>(
              `/api/market/trend?code=${code}`,
            ),
            readJson<{ bars: KBar[] }>(`/api/market/kline?code=${code}&period=day`).catch(() => ({ bars: [] as KBar[] })),
          ]);
          setTrend({ points: data.points, preClose: data.preClose, priorCloses: data.priorCloses ?? [] });
          if (day.bars.length) setBars(day.bars);
        } else {
          const data = await readJson<{ bars: KBar[] }>(`/api/market/kline?code=${code}&period=${mode}`);
          setBars(data.bars);
        }
        setError(null);
      } finally {
        if (!silent) setChartLoading(false);
      }
    },
    [code, mode],
  );

  useEffect(() => {
    setQuote(undefined);
    setBars([]);
    setTrend({ points: [], preClose: null, priorCloses: [] });
    setError(null);
  }, [code]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await loadQuote();
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
  }, [code, auto, trading, loadQuote, loadChart]);

  useEffect(() => {
    if (!code) return;
    loadChart().catch((err) => setError(err instanceof Error ? err.message : "K线加载失败"));
  }, [code, loadChart]);

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
