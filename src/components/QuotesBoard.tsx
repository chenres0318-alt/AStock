"use client";

import { useEffect, useState } from "react";
import { QUOTES_INSTRUMENTS } from "@/lib/quotesBoard";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import { isAbortError, readJson } from "@/lib/readJson";
import type { KBar, KlinePeriod } from "@/lib/types";
import AppHeader from "./AppHeader";
import IndexKlineChart from "./IndexKlineChart";
import { EmptyHint } from "./ui";

const PERIODS: Array<{ id: KlinePeriod; label: string }> = [
  { id: "day", label: "日K" },
  { id: "week", label: "周K" },
  { id: "month", label: "月K" },
];

type CardState = {
  bars: KBar[];
  loading: boolean;
  error: string | null;
};

function lastChange(bars: KBar[]): { close: number; pct: number | null } | null {
  const last = bars.at(-1);
  const prev = bars.at(-2);
  if (!last) return null;
  const pct = prev && prev.close > 0 ? ((last.close / prev.close - 1) * 100) : null;
  return { close: last.close, pct };
}

function InstrumentCard({
  code,
  name,
  digits = 2,
  period,
}: {
  code: string;
  name: string;
  digits?: number;
  period: KlinePeriod;
}) {
  const [state, setState] = useState<CardState>({ bars: [], loading: true, error: null });

  useEffect(() => {
    const ac = new AbortController();
    setState({ bars: [], loading: true, error: null });
    readJson<{ bars: KBar[] }>(`/api/market/kline?code=${encodeURIComponent(code)}&period=${period}`, {
      signal: ac.signal,
      timeoutMs: 20_000,
    })
      .then((data) => {
        if (ac.signal.aborted) return;
        setState({ bars: data.bars ?? [], loading: false, error: null });
      })
      .catch((error) => {
        if (ac.signal.aborted || isAbortError(error)) return;
        setState({ bars: [], loading: false, error: error instanceof Error ? error.message : "K线加载失败" });
      });
    return () => ac.abort();
  }, [code, period]);

  const chg = lastChange(state.bars);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm text-ink">{name}</h2>
        <div className="flex items-center gap-2">
          {chg ? (
            <span className={`num text-sm ${toneClass(chg.pct)}`}>
              {formatPrice(chg.close, digits)}
              <span className="ml-1 text-[11px]">{formatPct(chg.pct)}</span>
            </span>
          ) : null}
          <span className="text-[11px] text-mute">{PERIODS.find((item) => item.id === period)?.label}</span>
        </div>
      </div>
      {state.error ? <div className="px-3 py-2 text-xs text-up">{state.error}</div> : null}
      {state.loading && !state.bars.length ? (
        <EmptyHint text={`加载${name}${PERIODS.find((item) => item.id === period)?.label}…`} />
      ) : null}
      {state.bars.length ? <IndexKlineChart bars={state.bars} digits={digits} period={period} /> : null}
      {!state.loading && !state.bars.length && !state.error ? (
        <EmptyHint text={`${name}暂无${PERIODS.find((item) => item.id === period)?.label}数据`} />
      ) : null}
    </section>
  );
}

export default function QuotesBoard() {
  const [period, setPeriod] = useState<KlinePeriod>("day");
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-3 p-3">
      <AppHeader />
      <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm">行情：主要指数与商品的日 / 周 / 月 K 线</div>
          <div className="mt-1 text-xs text-mute">
            纳斯达克、标普、沪深300、科创50、创业板指、黄金、红利指数、银行指数、石油、日经225。红线为 4 周期均线。
          </div>
        </div>
        <div className="flex rounded-full bg-bg p-0.5 ring-1 ring-line">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPeriod(item.id)}
              className={`rounded-full px-3 py-1 text-xs ${
                period === item.id ? "bg-gold text-bg" : "text-mute hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {QUOTES_INSTRUMENTS.map((item) => (
          <InstrumentCard
            key={item.code}
            code={item.code}
            name={item.name}
            digits={item.digits ?? 2}
            period={period}
          />
        ))}
      </div>
    </div>
  );
}
