"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  QUOTES_INSTRUMENTS,
  dayWeekStandOnMa4,
  sortQuotesByMa4Stand,
  type QuotesInstrument,
} from "@/lib/quotesBoard";
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

type Slot = { bars: KBar[]; loading: boolean; error: string | null };
type LoadMap = Record<string, Partial<Record<KlinePeriod, Slot>>>;

function lastChange(bars: KBar[]): { close: number; pct: number | null } | null {
  const last = bars.at(-1);
  const prev = bars.at(-2);
  if (!last) return null;
  const pct = prev && prev.close > 0 ? ((last.close / prev.close - 1) * 100) : null;
  return { close: last.close, pct };
}

function emptySlot(): Slot {
  return { bars: [], loading: true, error: null };
}

function InstrumentCard({
  item,
  period,
  slot,
  stand,
}: {
  item: QuotesInstrument;
  period: KlinePeriod;
  slot: Slot;
  stand: boolean;
}) {
  const digits = item.digits ?? 2;
  const chg = lastChange(slot.bars);
  return (
    <section className={`panel overflow-hidden ${stand ? "ring-1 ring-cyan" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={`text-sm ${stand ? "text-cyan" : "text-ink"}`}>{item.name}</h2>
          {stand ? (
            <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-cyan">日周站上MA4</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {chg ? (
            <span className={`num text-sm ${toneClass(chg.pct)}`}>
              {formatPrice(chg.close, digits)}
              <span className="ml-1 text-[11px]">{formatPct(chg.pct)}</span>
            </span>
          ) : null}
          <span className="text-[11px] text-mute">{PERIODS.find((row) => row.id === period)?.label}</span>
        </div>
      </div>
      {slot.error ? <div className="px-3 py-2 text-xs text-up">{slot.error}</div> : null}
      {slot.loading && !slot.bars.length ? (
        <EmptyHint text={`加载${item.name}${PERIODS.find((row) => row.id === period)?.label}…`} />
      ) : null}
      {slot.bars.length ? (
        <IndexKlineChart bars={slot.bars} digits={digits} period={period} stand={stand} />
      ) : null}
      {!slot.loading && !slot.bars.length && !slot.error ? (
        <EmptyHint text={`${item.name}暂无${PERIODS.find((row) => row.id === period)?.label}数据`} />
      ) : null}
    </section>
  );
}

function loadPeriod(code: string, period: KlinePeriod, signal: AbortSignal) {
  return readJson<{ bars: KBar[] }>(`/api/market/kline?code=${encodeURIComponent(code)}&period=${period}`, {
    signal,
    timeoutMs: 20_000,
  }).then((data) => data.bars ?? []);
}

function fillKinds(kinds: KlinePeriod[], signal: AbortSignal, setLoads: Dispatch<SetStateAction<LoadMap>>) {
  for (const item of QUOTES_INSTRUMENTS) {
    for (const kind of kinds) {
      setLoads((prev) => {
        const current = prev[item.code]?.[kind];
        if (current && !current.loading && (current.bars.length || current.error)) return prev;
        return {
          ...prev,
          [item.code]: { ...prev[item.code], [kind]: current?.loading ? current : emptySlot() },
        };
      });
      loadPeriod(item.code, kind, signal)
        .then((bars) => {
          if (signal.aborted) return;
          setLoads((prev) => ({
            ...prev,
            [item.code]: { ...prev[item.code], [kind]: { bars, loading: false, error: null } },
          }));
        })
        .catch((error) => {
          if (signal.aborted || isAbortError(error)) return;
          setLoads((prev) => ({
            ...prev,
            [item.code]: {
              ...prev[item.code],
              [kind]: {
                bars: [],
                loading: false,
                error: error instanceof Error ? error.message : "K线加载失败",
              },
            },
          }));
        });
    }
  }
}

export default function QuotesBoard() {
  const [period, setPeriod] = useState<KlinePeriod>("day");
  const [loads, setLoads] = useState<LoadMap>({});

  useEffect(() => {
    const ac = new AbortController();
    fillKinds(["day", "week"], ac.signal, setLoads);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (period !== "month") return;
    const ac = new AbortController();
    fillKinds(["month"], ac.signal, setLoads);
    return () => ac.abort();
  }, [period]);

  const ordered = useMemo(
    () =>
      sortQuotesByMa4Stand(QUOTES_INSTRUMENTS, (item) =>
        dayWeekStandOnMa4(loads[item.code]?.day?.bars, loads[item.code]?.week?.bars),
      ),
    [loads],
  );
  const standCount = ordered.filter((item) =>
    dayWeekStandOnMa4(loads[item.code]?.day?.bars, loads[item.code]?.week?.bars),
  ).length;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-3 p-3">
      <AppHeader />
      <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm">行情：主要指数与商品的日 / 周 / 月 K 线</div>
          <div className="mt-1 text-xs text-mute">
            金线为 MA4。日 K、周 K 收盘都站上 MA4 的用青色标出并排在前面
            {standCount ? <span className="ml-1 text-cyan">· {standCount} 个</span> : null}。
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
        {ordered.map((item) => {
          const stand = dayWeekStandOnMa4(loads[item.code]?.day?.bars, loads[item.code]?.week?.bars);
          return (
            <InstrumentCard
              key={item.code}
              item={item}
              period={period}
              slot={loads[item.code]?.[period] ?? emptySlot()}
              stand={stand}
            />
          );
        })}
      </div>
    </div>
  );
}
