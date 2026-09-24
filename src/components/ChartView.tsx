"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatPrice } from "@/lib/format";
import { buildRedRibbon, klineRangeChange, maAt, type RibbonPoint } from "@/lib/indicators";
import type { KBar, Quote, TrendPoint } from "@/lib/types";

export type ChartMode = "trend" | "day" | "week" | "month";

const UP = "#ff5c5c";
const DOWN = "#1ecb93";
const RIBBON_CYAN = "#2ad4c8";
const RIBBON_LAYERS = 7;

function formatChartTime(time: unknown, withDate: boolean): string {
  if (typeof time === "string") return withDate ? time : time.slice(5);
  if (typeof time === "object" && time && "year" in time) {
    const t = time as { year: number; month: number; day: number };
    const value = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
    return withDate ? value : value.slice(5);
  }
  const ts = typeof time === "number" ? time : Number(time);
  if (!Number.isFinite(ts)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: withDate ? "2-digit" : undefined,
    day: withDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ts * 1000));
}

function ribbonSeriesData(points: RibbonPoint[], layer: number) {
  const data: Array<{ time: string; value: number; color: string }> = [];
  for (const point of points) {
    const direction = point.direction[layer];
    if (direction == null) continue;
    data.push({
      time: point.time,
      value: point.values[layer],
      color: direction === "up" ? UP : RIBBON_CYAN,
    });
  }
  return data;
}

function ma5Line(bars: KBar[]): Array<{ time: string; value: number }> {
  const closes = bars.map((bar) => bar.close);
  const points: Array<{ time: string; value: number }> = [];
  for (let i = 0; i < bars.length; i += 1) {
    const ma = maAt(closes, 5, i);
    if (ma == null) continue;
    points.push({ time: bars[i].time, value: ma });
  }
  return points;
}

function applyTimeScale(chart: IChartApi, mode: ChartMode, barCount: number, resetRange: boolean) {
  chart.timeScale().applyOptions({
    timeVisible: mode === "trend",
    secondsVisible: false,
    fixLeftEdge: mode !== "day",
    fixRightEdge: true,
  });
  if (!resetRange) return;
  requestAnimationFrame(() => {
    if (mode === "day" && barCount > 80) {
      chart.timeScale().setVisibleLogicalRange({
        from: barCount - 80,
        to: barCount + 4,
      });
      return;
    }
    chart.timeScale().fitContent();
  });
}

/** 可见 K 线越少，价格轴收得越紧，红青丝带才不会挤成一条。 */
function magnifiedPriceRange(chart: IChartApi, bars: KBar[]): AutoscaleInfo | null {
  const range = chart.timeScale().getVisibleLogicalRange();
  if (!range || bars.length === 0) return null;
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.min(bars.length - 1, Math.ceil(range.to));
  const count = to - from + 1;
  if (count < 2 || count >= 42) return null;
  let low = Infinity;
  let high = -Infinity;
  for (let i = from; i <= to; i += 1) {
    low = Math.min(low, bars[i].low);
    high = Math.max(high, bars[i].high);
  }
  if (!(high > low)) return null;
  // 42 根仍用完整高低点。收到大约 20 根时，纵轴只留高低点的 45%，丝带层才会分开。
  const tighten = Math.min(1, (42 - count) / 22);
  const zoom = 1 - tighten * 0.55;
  const mid = (low + high) / 2;
  const half = Math.max((high - low) * zoom, mid * 0.015) / 2;
  return { priceRange: { minValue: mid - half, maxValue: mid + half } };
}

type BarSpan = { from: string; to: string };

function selectionBox(chart: IChartApi, from: string, to: string): { left: number; width: number } | null {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const scale = chart.timeScale();
  const x1 = scale.timeToCoordinate(start as Time);
  const x2 = scale.timeToCoordinate(end as Time);
  if (x1 == null || x2 == null) return null;
  const spacing = scale.options().barSpacing;
  const left = Math.min(x1, x2) - spacing / 2;
  const right = Math.max(x1, x2) + spacing / 2;
  return { left, width: Math.max(spacing, right - left) };
}

function barTimeAt(chart: IChartApi, bars: KBar[], x: number): string | null {
  if (bars.length === 0) return null;
  const time = chart.timeScale().coordinateToTime(x);
  if (typeof time === "string") return time;
  const logical = chart.timeScale().coordinateToLogical(x);
  if (logical == null) return null;
  const index = Math.min(bars.length - 1, Math.max(0, Math.round(logical)));
  return bars[index]?.time ?? null;
}

export default function ChartView({
  mode,
  onMode,
  bars,
  trend,
  quote,
  loading,
}: {
  mode: ChartMode;
  onMode: (mode: ChartMode) => void;
  bars: KBar[];
  trend: { points: TrendPoint[]; preClose: number | null };
  quote?: Quote;
  loading: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ribbonRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const avgRef = useRef<ISeriesApi<"Line"> | null>(null);
  const preCloseLineRef = useRef<IPriceLine | null>(null);
  const viewRef = useRef({ mode, barCount: bars.length });
  const barsRef = useRef(bars);
  const modeRef = useRef(mode);
  const rangeKeyRef = useRef("");
  const dragRef = useRef<BarSpan | null>(null);
  const pickedRef = useRef<BarSpan | null>(null);
  const placeRef = useRef<() => void>(() => {});
  const [rangeMode, setRangeMode] = useState(false);
  const [picked, setPicked] = useState<BarSpan | null>(null);
  const [highlight, setHighlight] = useState<{ left: number; width: number } | null>(null);
  const seriesKey = `${mode}:${bars[0]?.time ?? ""}:${bars.at(-1)?.time ?? ""}`;
  const [trackedKey, setTrackedKey] = useState(seriesKey);
  if (trackedKey !== seriesKey) {
    setTrackedKey(seriesKey);
    setRangeMode(false);
    setPicked(null);
    setHighlight(null);
    dragRef.current = null;
  }
  viewRef.current = { mode, barCount: bars.length };
  barsRef.current = bars;
  modeRef.current = mode;
  pickedRef.current = trackedKey === seriesKey ? picked : null;
  placeRef.current = () => {
    const chart = chartRef.current;
    const span = dragRef.current ?? pickedRef.current;
    if (!chart || !span || modeRef.current === "trend") {
      setHighlight(null);
      return;
    }
    setHighlight(selectionBox(chart, span.from, span.to));
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#10151e" },
        textColor: "#7d879c",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "#1b2331" },
        horzLines: { color: "#1b2331" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#273042" },
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time, true),
      },
      timeScale: {
        borderColor: "#273042",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: Time) => formatChartTime(time, false),
      },
      autoSize: true,
      handleScale: {
        mouseWheel: false,
      },
    });
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const current = chart.timeScale().options().barSpacing;
      const zoomIn = event.deltaY < 0;
      const next = current * (zoomIn ? 1.35 : 1 / 1.35);
      chart.timeScale().applyOptions({
        barSpacing: Math.min(96, Math.max(2, next)),
      });
      requestAnimationFrame(() => placeRef.current());
    };
    const wheelHost = el.parentElement ?? el;
    wheelHost.addEventListener("wheel", onWheel, { passive: false });
    const onVisible = () => placeRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisible);
    const autoscaleInfoProvider = (original: () => AutoscaleInfo | null) => {
      if (modeRef.current === "trend") return original();
      return magnifiedPriceRange(chart, barsRef.current) ?? original();
    };
    const candle = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      autoscaleInfoProvider,
    });
    const line = chart.addLineSeries({
      color: "#e4b454",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      autoscaleInfoProvider,
    });
    const avg = chart.addLineSeries({
      color: "#6ea8ff",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ribbons: Array<ISeriesApi<"Line">> = [];
    for (let layer = 0; layer < RIBBON_LAYERS; layer += 1) {
      ribbons.push(
        chart.addLineSeries({
          color: UP,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider,
        }),
      );
    }
    ribbonRef.current = ribbons;
    const vol = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.06, bottom: 0.22 },
    });
    chartRef.current = chart;
    candleRef.current = candle;
    lineRef.current = line;
    avgRef.current = avg;
    volRef.current = vol;
    const ro = new ResizeObserver(() => {
      const { mode: currentMode, barCount } = viewRef.current;
      applyTimeScale(chart, currentMode, barCount, false);
      requestAnimationFrame(() => placeRef.current());
    });
    ro.observe(el);
    return () => {
      wheelHost.removeEventListener("wheel", onWheel);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisible);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  const ribbonCounts = useMemo(() => {
    if (mode === "trend") return { buy: 0, sell: 0 };
    const { signals } = buildRedRibbon(bars);
    return {
      buy: signals.filter((item) => item.side === "buy").length,
      sell: signals.filter((item) => item.side === "sell").length,
    };
  }, [mode, bars]);

  useEffect(() => {
    const candle = candleRef.current;
    const vol = volRef.current;
    const line = lineRef.current;
    const avg = avgRef.current;
    const chart = chartRef.current;
    if (!candle || !vol || !line || !avg || !chart) return;

    if (preCloseLineRef.current) {
      line.removePriceLine(preCloseLineRef.current);
      preCloseLineRef.current = null;
    }

    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.06, bottom: mode === "day" ? 0.28 : 0.22 },
    });
    line.applyOptions({
      lineWidth: mode === "trend" ? 2 : 1,
      lastValueVisible: true,
    });

    if (mode === "trend") {
      const points = trend.points.filter((item) => item.timestamp > 0 && item.time <= "15:00");
      candle.setData([]);
      candle.setMarkers([]);
      ribbonRef.current.forEach((series) => series.setData([]));
      line.setData(
        points.map((item) => ({
          time: item.timestamp as UTCTimestamp,
          value: item.price,
        })),
      );
      avg.setData(
        points
          .filter((item) => item.avg != null)
          .map((item) => ({
            time: item.timestamp as UTCTimestamp,
            value: item.avg as number,
          })),
      );
      vol.setData(
        points.map((item, index) => {
          const prev = index > 0 ? points[index - 1].price : trend.preClose ?? item.price;
          return {
            time: item.timestamp as UTCTimestamp,
            value: item.volume,
            color: item.price >= prev ? "rgba(255,92,92,0.6)" : "rgba(30,203,147,0.6)",
          };
        }),
      );
      if (trend.preClose) {
        preCloseLineRef.current = line.createPriceLine({
          price: trend.preClose,
          color: "#8e99ad",
          lineStyle: LineStyle.Dotted,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "昨收",
        });
      }
      line.setMarkers([]);
      const trendKey = `trend:${trend.points.length}:${trend.points.at(-1)?.timestamp ?? ""}`;
      const resetTrend = rangeKeyRef.current !== trendKey;
      rangeKeyRef.current = trendKey;
      applyTimeScale(chart, mode, trend.points.length, resetTrend);
      return;
    }

    line.setData(ma5Line(bars));
    line.setMarkers([]);
    avg.setData([]);
    const ribbon = buildRedRibbon(bars);
    ribbonRef.current.forEach((series, layer) => {
      series.setData(ribbonSeriesData(ribbon.points, layer));
    });
    candle.setData(
      bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    vol.setData(
      bars.map((bar) => ({
        time: bar.time,
        value: bar.volume,
        color: bar.close >= bar.open ? "rgba(255,92,92,0.6)" : "rgba(30,203,147,0.6)",
      })),
    );
    candle.setMarkers(
      ribbon.signals.map((point) =>
        point.side === "buy"
          ? {
              time: point.time,
              position: "belowBar" as const,
              color: UP,
              shape: "arrowUp" as const,
              text: "买",
              size: 1.2,
            }
          : {
              time: point.time,
              position: "aboveBar" as const,
              color: RIBBON_CYAN,
              shape: "arrowDown" as const,
              text: "卖",
              size: 1.2,
            },
      ),
    );
    const rangeKey = `${mode}:${bars.length}:${bars[0]?.time ?? ""}:${bars.at(-1)?.time ?? ""}`;
    const resetRange = rangeKeyRef.current !== rangeKey;
    rangeKeyRef.current = rangeKey;
    applyTimeScale(chart, mode, bars.length, resetRange);
    requestAnimationFrame(() => placeRef.current());
  }, [bars, trend, mode]);

  const stats = useMemo(() => {
    if (!picked || mode === "trend") return null;
    return klineRangeChange(bars, picked.from, picked.to);
  }, [picked, bars, mode]);

  const timeFromClientX = (clientX: number) => {
    const chart = chartRef.current;
    const box = boxRef.current;
    if (!chart || !box) return null;
    return barTimeAt(chart, barsRef.current, clientX - box.getBoundingClientRect().left);
  };

  const onRangePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const time = timeFromClientX(event.clientX);
    if (!time) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { from: time, to: time };
    dragRef.current = next;
    setPicked(next);
    const chart = chartRef.current;
    setHighlight(chart ? selectionBox(chart, time, time) : null);
  };

  const onRangePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const time = timeFromClientX(event.clientX);
    if (!time || time === drag.to) return;
    const next = { from: drag.from, to: time };
    dragRef.current = next;
    setPicked(next);
    const chart = chartRef.current;
    setHighlight(chart ? selectionBox(chart, next.from, next.to) : null);
  };

  const onRangePointerUp = () => {
    dragRef.current = null;
  };
  const tabs: Array<{ id: ChartMode; label: string }> = [
    { id: "trend", label: "分时" },
    { id: "day", label: "日K" },
    { id: "week", label: "周K" },
    { id: "month", label: "月K" },
  ];

  return (
    <section className="panel flex min-h-[560px] flex-1 flex-col overflow-hidden xl:min-h-0">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onMode(tab.id)}
              className={`rounded px-2.5 py-1 text-xs ${
                mode === tab.id ? "bg-gold text-bg" : "text-mute hover:bg-panel-2 hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <span className="mx-1 h-3 w-px bg-line" />
          <button
            type="button"
            aria-pressed={rangeMode}
            disabled={mode === "trend"}
            onClick={() => {
              if (mode === "trend") return;
              if (rangeMode) {
                dragRef.current = null;
                setPicked(null);
                setHighlight(null);
                setRangeMode(false);
                return;
              }
              setRangeMode(true);
            }}
            className={`rounded px-2.5 py-1 text-xs ${
              mode === "trend"
                ? "cursor-not-allowed text-mute/40"
                : rangeMode
                  ? "bg-gold text-bg"
                  : "text-mute hover:bg-panel-2 hover:text-ink"
            }`}
          >
            区间统计
          </button>
        </div>
        <div className="text-[11px] text-mute">
          {quote?.name ?? ""}{" "}
          {loading
            ? "加载中…"
            : mode === "trend"
              ? "黄线现价 蓝线均价"
              : `黄线MA5 · 红青丝带 · 买 ${ribbonCounts.buy} 卖 ${ribbonCounts.sell}`}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={boxRef} className="absolute inset-0" />
        {highlight && mode !== "trend" ? (
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-10 bg-gold/15"
            style={{
              left: highlight.left,
              width: highlight.width,
              boxShadow: "inset 0 0 0 1px rgba(228,180,84,0.7)",
            }}
          />
        ) : null}
        {stats && highlight ? <RangeChip stats={stats} highlight={highlight} plotWidth={boxRef.current?.clientWidth ?? 0} /> : null}
        {rangeMode && mode !== "trend" && !stats ? (
          <div className="pointer-events-none absolute left-3 top-2 z-30 rounded bg-panel/80 px-2 py-1 text-[11px] text-mute">
            拖拽选择 K 线区间
          </div>
        ) : null}
        {rangeMode && mode !== "trend" ? (
          <div
            className="absolute inset-0 z-20 cursor-crosshair"
            onPointerDown={onRangePointerDown}
            onPointerMove={onRangePointerMove}
            onPointerUp={onRangePointerUp}
            onPointerCancel={onRangePointerUp}
          />
        ) : null}
        {loading ? (
          <div className="absolute inset-0 z-40 grid place-items-center bg-panel/40 text-sm text-mute">行情图加载中…</div>
        ) : null}
      </div>
    </section>
  );
}

function RangeChip({
  stats,
  highlight,
  plotWidth,
}: {
  stats: NonNullable<ReturnType<typeof klineRangeChange>>;
  highlight: { left: number; width: number };
  plotWidth: number;
}) {
  const sameYear = stats.from.slice(0, 4) === stats.to.slice(0, 4);
  const dates = sameYear
    ? `${stats.from.slice(0, 4)}  ${stats.from.slice(5)} → ${stats.to.slice(5)}`
    : `${stats.from} → ${stats.to}`;
  const tone = stats.pct > 0 ? "text-up" : stats.pct < 0 ? "text-down" : "text-flat";
  const pct = `${stats.pct > 0 ? "+" : ""}${(stats.pct * 100).toFixed(2)}%`;
  const center = highlight.left + highlight.width / 2;
  const margin = 110;
  const rightLimit = Math.max(margin, plotWidth - 72 - margin);
  const left = Math.min(Math.max(center, margin), rightLimit);
  return (
    <div
      className="num pointer-events-none absolute z-30 -translate-x-1/2 rounded border border-line bg-panel/95 px-2 py-1 text-[11px] leading-4 shadow"
      style={{ left, top: 8 }}
    >
      <div className="text-mute">
        {dates} · {stats.count}根
      </div>
      <div>
        {formatPrice(stats.start)} → {formatPrice(stats.end)} <span className={tone}>{pct}</span>
      </div>
    </div>
  );
}
