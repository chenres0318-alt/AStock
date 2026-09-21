"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { KBar, Quote, TrendPoint } from "@/lib/types";

export type ChartMode = "trend" | "day" | "week" | "month";

const UP = "#ff5c5c";
const DOWN = "#1ecb93";

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
  const avgRef = useRef<ISeriesApi<"Line"> | null>(null);
  const preCloseLineRef = useRef<IPriceLine | null>(null);

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
      timeScale: { borderColor: "#273042", timeVisible: mode === "trend", secondsVisible: false },
      autoSize: true,
    });
    const candle = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    const line = chart.addLineSeries({
      color: "#e4b454",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    const avg = chart.addLineSeries({
      color: "#6ea8ff",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const vol = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    candle.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.24 },
    });
    line.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.24 },
    });
    chartRef.current = chart;
    candleRef.current = candle;
    lineRef.current = line;
    avgRef.current = avg;
    volRef.current = vol;
    preCloseLineRef.current = null;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    const candle = candleRef.current;
    const vol = volRef.current;
    const line = lineRef.current;
    const avg = avgRef.current;
    const chart = chartRef.current;
    if (!candle || !vol || !line || !avg || !chart) return;

    if (mode === "trend") {
      candle.setData([]);
      const points = trend.points.filter((item) => item.timestamp > 0);
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
            color: item.price >= prev ? "rgba(255,92,92,0.55)" : "rgba(30,203,147,0.55)",
          };
        }),
      );
      if (preCloseLineRef.current) {
        line.removePriceLine(preCloseLineRef.current);
        preCloseLineRef.current = null;
      }
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
      chart.timeScale().fitContent();
      return;
    }

    line.setData([]);
    avg.setData([]);
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
        color: bar.close >= bar.open ? "rgba(255,92,92,0.55)" : "rgba(30,203,147,0.55)",
      })),
    );
    chart.timeScale().fitContent();
  }, [bars, trend, mode]);

  const tabs: Array<{ id: ChartMode; label: string }> = [
    { id: "trend", label: "分时" },
    { id: "day", label: "日K" },
    { id: "week", label: "周K" },
    { id: "month", label: "月K" },
  ];

  return (
    <section className="panel flex min-h-[360px] flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex gap-1">
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
        </div>
        <div className="text-[11px] text-mute">{quote?.name ?? ""} {loading ? "加载中…" : ""}</div>
      </div>
      <div className="relative min-h-[300px] flex-1">
        <div ref={boxRef} className="absolute inset-0" />
        {loading ? (
          <div className="absolute inset-0 grid place-items-center bg-panel/40 text-sm text-mute">行情图加载中…</div>
        ) : null}
      </div>
    </section>
  );
}
