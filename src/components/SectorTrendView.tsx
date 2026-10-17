"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { displaySymbol, isTonghuashunIndustry, toTencentCode } from "@/lib/codes";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import type { KBar, SectorItem } from "@/lib/types";
import type { SectorTrendView as TrendBox } from "@/lib/sectorTrendData";
import AppHeader from "./AppHeader";
import { EmptyHint } from "./ui";

type Report = {
  board: SectorItem;
  bars: KBar[];
  trends: TrendBox[];
  pct5: number | null;
  memberCount: number;
};

async function readJson<T>(url: string, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function gainText(gain: number): string {
  return formatPct(gain * 100);
}

function boxSpan(trend: { start: string; end: string }): string {
  return trend.start === trend.end ? trend.start : `${trend.start} ~ ${trend.end}`;
}

function boxState(trend: { status: string; start: string; end: string }): string {
  if (trend.status === "closed") return "灰框已收口";
  if (trend.start === trend.end) return "疑似启动";
  return "红框试运行";
}

export default function SectorTrendView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";
  const [boards, setBoards] = useState<SectorItem[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveCodes, setLiveCodes] = useState<string[]>([]);

  useEffect(() => {
    readJson<{ items: SectorItem[] }>("/api/market/sectors?scope=all")
      .then((data) => {
        setBoards(data.items);
        if (isTonghuashunIndustry(code) && data.items.some((item) => item.code === code)) return;
        const preferred =
          data.items.find((item) => item.code === "881121" || item.name === "半导体") ?? data.items[0];
        if (preferred && preferred.code !== code) router.replace(`/sector?code=${preferred.code}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "板块列表失败"));
  }, [code, router]);

  useEffect(() => {
    let cancelled = false;
    readJson<{ codes: string[] }>("/api/market/sector-trend?list=active", 300_000)
      .then((data) => {
        if (!cancelled) setLiveCodes(data.codes ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTonghuashunIndustry(code)) return;
    let cancelled = false;
    setLoading(true);
    setReport(null);
    readJson<Report>(`/api/market/sector-trend?code=${code}`)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        const open = data.trends.find((item) => item.status === "open");
        setPicked((open ?? data.trends.at(-1))?.start ?? null);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "趋势计算失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const liveSet = useMemo(() => {
    const set = new Set(liveCodes);
    const last = report?.bars.at(-1)?.time;
    const selfLive = report?.trends.some((item) => item.status === "open" && item.end === last) ?? false;
    if (code && report) {
      if (selfLive) set.add(code);
      else set.delete(code);
    }
    return set;
  }, [liveCodes, report, code]);

  const selected = report?.trends.find((item) => item.start === picked) ?? report?.trends.at(-1) ?? null;
  const upTotal =
    report?.board.upCount != null
      ? `${report.board.upCount}/${(report.board.upCount ?? 0) + (report.board.downCount ?? 0)}`
      : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1280px] flex-col gap-3 p-3">
      <AppHeader />
      <section className="panel px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm">近期趋势捕捉</div>
            <div className="mt-1 max-w-3xl text-xs leading-5 text-mute">
              打出低点的当天，收盘拉到日内高位，当天涨幅或从低点拉起的幅度够，并且多数个股在涨、有领涨龙头，就按疑似启动画出红框。低点守住之后，框延伸到最新一根。跌破这个低点，疑似启动撤回。已经走出的一段如果涨幅回吐，改成灰框，终点留在高点。
            </div>
          </div>
          <BoardPicker
            boards={boards}
            code={code}
            liveCodes={liveSet}
            onPick={(next) => router.push(`/sector?code=${next}`)}
          />
        </div>
        {report ? (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <div className={liveSet.has(report.board.code) ? "text-lg text-up" : "text-lg"}>{report.board.name}</div>
              <div className="text-[11px] text-mute">{report.board.code}</div>
            </div>
            <Stat label="5日涨幅" value={formatPct(report.pct5)} tone={report.pct5} />
            <Stat label="最新涨幅" value={formatPct(report.board.pct)} tone={report.board.pct} />
            <Stat label="上涨股个数" value={upTotal ?? "--"} />
          </div>
        ) : null}
      </section>

      {error ? <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div> : null}

      <section className="panel flex min-h-[460px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-mute">
          <span>{selected ? boxSpan(selected) : "最近一段"}</span>
          <span className={selected ? toneClass(selected.gain) : ""}>
            {selected ? `${boxState(selected)} ${gainText(selected.gain)}` : loading ? "计算中…" : "没有画出趋势"}
          </span>
        </div>
        <TrendChart
          bars={report?.bars ?? []}
          trends={report?.trends ?? []}
          selectedStart={selected?.start ?? null}
          onSelect={setPicked}
        />
      </section>

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className="panel px-3 py-3">
          <div className="text-sm">这段龙头</div>
          {selected?.leaders.length ? (
            <ol className="mt-2 space-y-2">
              {selected.leaders.map((item, index) => (
                <li key={item.code} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="mr-2 text-mute">{index + 1}</span>
                    {item.name}
                  </span>
                  <span className={`num ${toneClass(item.gain)}`}>{gainText(item.gain)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyHint text="这段没有领涨名单" />
          )}
          {selected ? (
            <div className="mt-3 text-[11px] leading-5 text-mute">
              区间内上涨 {selected.upCount}/{selected.memberCount}，占比 {(selected.upRatio * 100).toFixed(0)}%。
            </div>
          ) : null}
          <div className="mt-4 border-t border-line pt-3">
            <div className="text-sm">MA4上穿MA7</div>
            {selected?.maCrosses.length ? (
              <ol className="mt-2 max-h-72 space-y-2 overflow-auto scroll-thin">
                {selected.maCrosses.map((item, index) => (
                  <li key={item.code} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/?code=${toTencentCode(item.code)}`} className="min-w-0 hover:text-gold">
                      <span className="mr-2 text-mute">{index + 1}</span>
                      {item.name}
                      <span className="ml-2 text-[11px] text-mute">{displaySymbol(item.code)}</span>
                    </Link>
                    <span className="num shrink-0 text-mute">{item.time.slice(5)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyHint text="这段没有MA4上穿MA7的个股" />
            )}
          </div>
        </section>
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-3 py-2 text-sm">成分股</div>
          <MemberTable rows={selected?.roster ?? []} />
        </section>
      </div>
    </div>
  );
}

function BoardPicker({
  boards,
  code,
  liveCodes,
  onPick,
}: {
  boards: SectorItem[];
  code: string;
  liveCodes: Set<string>;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => {
    return [...boards].sort((a, b) => {
      const rank = (item: SectorItem) => (liveCodes.has(item.code) ? 0 : 1);
      const byLive = rank(a) - rank(b);
      if (byLive !== 0) return byLive;
      return a.name.localeCompare(b.name, "zh-CN");
    });
  }, [boards, liveCodes]);
  const current = boards.find((item) => item.code === code);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const currentRow = rootRef.current?.querySelector("[data-current='true']");
    currentRow?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative text-xs text-mute">
      <div className="mb-1">板块</div>
      <button
        type="button"
        className="flex min-w-36 items-center justify-between gap-3 rounded bg-panel-2 px-2 py-1 text-left text-sm ring-1 ring-line"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={liveCodes.has(code) ? "text-up" : "text-ink"}>{current?.name ?? "选择板块"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-52 overflow-auto rounded bg-panel py-1 shadow-lg ring-1 ring-line scroll-thin">
          {ordered.map((item) => {
            const live = liveCodes.has(item.code);
            const selected = item.code === code;
            return (
              <button
                key={item.code}
                type="button"
                data-current={selected ? "true" : undefined}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                  selected ? "bg-white/10" : "hover:bg-panel-2"
                } ${live ? "text-up" : "text-ink"}`}
                onClick={() => {
                  setOpen(false);
                  if (item.code !== code) onPick(item.code);
                }}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return (
    <div>
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`num text-sm ${toneClass(tone)}`}>{value}</div>
    </div>
  );
}

function MemberTable({ rows }: { rows: TrendBox["roster"] }) {
  if (!rows.length) return <EmptyHint text="成分股还在加载" />;
  return (
    <div className="max-h-[420px] overflow-auto scroll-thin">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] text-mute">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-normal">股票</th>
            <th className="px-3 py-2 text-right font-normal">最新</th>
            <th className="px-3 py-2 text-right font-normal">当日涨幅</th>
            <th className="px-3 py-2 text-right font-normal">区间涨幅</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.code} className="border-b border-line/70">
              <td className="px-3 py-2">
                <div>{item.name}</div>
                <div className="text-[11px] text-mute">{displaySymbol(item.code)}</div>
              </td>
              <td className="num px-3 py-2 text-right">{formatPrice(item.price)}</td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.pct)}`}>{formatPct(item.pct)}</td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.gain)}`}>
                {item.gain == null ? "--" : gainText(item.gain)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendChart({
  bars,
  trends,
  selectedStart,
  onSelect,
}: {
  bars: KBar[];
  trends: TrendBox[];
  selectedStart: string | null;
  onSelect: (start: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const trendsRef = useRef(trends);
  trendsRef.current = trends;
  const [boxes, setBoxes] = useState<Array<{ start: string; left: number; width: number; status: TrendBox["status"] }>>([]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8e99ad",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
      },
      grid: { vertLines: { color: "#1c2433" }, horzLines: { color: "#1c2433" } },
      rightPriceScale: { borderColor: "#273042" },
      timeScale: { borderColor: "#273042", rightOffset: 2 },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: true,
      handleScale: true,
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#ff5c5c",
      downColor: "#1ecb93",
      borderUpColor: "#ff5c5c",
      borderDownColor: "#1ecb93",
      wickUpColor: "#ff5c5c",
      wickDownColor: "#1ecb93",
    });
    chartRef.current = chart;
    candleRef.current = candle;
    const place = () => {
      const scale = chart.timeScale();
      const next = trendsRef.current
        .map((item) => {
          const x1 = scale.timeToCoordinate(item.start as Time);
          const x2 = scale.timeToCoordinate(item.end as Time);
          if (x1 == null || x2 == null) return null;
          const left = Math.min(x1, x2);
          const width = Math.max(8, Math.abs(x2 - x1));
          return { start: item.start, left, width, status: item.status };
        })
        .filter((item): item is { start: string; left: number; width: number; status: TrendBox["status"] } => item != null);
      setBoxes(next);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(place);
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(place);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (!candle || !chart || !bars.length) return;
    candle.setData(
      bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    const latest = trendsRef.current.at(-1);
    const trendIndex = latest ? bars.findIndex((bar) => bar.time === latest.start) : -1;
    const from = Math.max(0, Math.min(bars.length - 90, trendIndex >= 0 ? trendIndex - 8 : bars.length - 90));
    chart.timeScale().setVisibleLogicalRange({ from, to: bars.length + 1 });
    requestAnimationFrame(() => {
      const scale = chart.timeScale();
      const next = trendsRef.current
        .map((item) => {
          const x1 = scale.timeToCoordinate(item.start as Time);
          const x2 = scale.timeToCoordinate(item.end as Time);
          if (x1 == null || x2 == null) return null;
          return {
            start: item.start,
            left: Math.min(x1, x2),
            width: Math.max(8, Math.abs(x2 - x1)),
            status: item.status,
          };
        })
        .filter((item): item is { start: string; left: number; width: number; status: TrendBox["status"] } => item != null);
      setBoxes(next);
    });
  }, [bars, trends]);

  const labels = useMemo(() => {
    const byStart = new Map(trends.map((item) => [item.start, item]));
    return boxes.map((box) => ({ ...box, trend: byStart.get(box.start) })).filter((item) => item.trend);
  }, [boxes, trends]);

  return (
    <div className="relative min-h-[380px] flex-1">
      <div ref={boxRef} className="absolute inset-0" />
      {labels.map((item) => (
        <button
          key={item.start}
          type="button"
          className="absolute bottom-8 top-2 z-10 rounded-sm"
          style={{
            left: item.left,
            width: item.width,
            background: item.status === "open" ? "rgba(255,92,92,0.16)" : "rgba(142,153,173,0.14)",
            boxShadow: item.start === selectedStart ? "inset 0 0 0 1px rgba(228,180,84,0.9)" : "inset 0 0 0 1px rgba(255,255,255,0.08)",
          }}
          onClick={() => onSelect(item.start)}
        >
          <span className={`pointer-events-none absolute left-1 top-1 text-[10px] ${item.status === "open" ? "text-up" : "text-mute"}`}>
            {item.trend
              ? `${item.trend.start === item.trend.end ? item.trend.start.slice(5) : `${item.trend.start.slice(5)} ~ ${item.trend.end.slice(5)}`} ${gainText(item.trend.gain)}`
              : ""}
          </span>
        </button>
      ))}
      {!bars.length ? <div className="absolute inset-0 grid place-items-center text-sm text-mute">选择板块后计算趋势</div> : null}
    </div>
  );
}
