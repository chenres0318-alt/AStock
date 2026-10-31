"use client";

import { useEffect, useRef } from "react";
import { ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { maAt } from "@/lib/indicators";
import type { KBar, KlinePeriod } from "@/lib/types";

const UP = "#ff5c5c";
const DOWN = "#1ecb93";

function formatChartTime(time: unknown, withDate: boolean, period: KlinePeriod): string {
  let value = "";
  if (typeof time === "string") value = time;
  else if (typeof time === "object" && time && "year" in time) {
    const t = time as { year: number; month: number; day: number };
    value = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  }
  if (!value) return "";
  if (period === "month") return value.slice(0, 7);
  return withDate ? value : value.slice(5);
}

export default function IndexKlineChart({
  bars,
  digits = 2,
  period = "day",
}: {
  bars: KBar[];
  digits?: number;
  period?: KlinePeriod;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const maRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#10151e" },
        textColor: "#7d879c",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1b2331" },
        horzLines: { color: "#1b2331" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#273042" },
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time, true, period),
      },
      timeScale: {
        borderColor: "#273042",
        timeVisible: false,
        secondsVisible: false,
        rightOffset: 4,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: Time) => formatChartTime(time, false, period),
      },
      autoSize: true,
    });
    const candle = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    const ma4 = chart.addLineSeries({
      color: UP,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    candleRef.current = candle;
    maRef.current = ma4;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      maRef.current = null;
    };
  }, [period]);

  useEffect(() => {
    const candle = candleRef.current;
    const ma4 = maRef.current;
    const chart = chartRef.current;
    if (!candle || !ma4 || !chart) return;
    const minMove = digits >= 3 ? 0.001 : 0.01;
    candle.applyOptions({ priceFormat: { type: "price", precision: digits, minMove } });
    ma4.applyOptions({ priceFormat: { type: "price", precision: digits, minMove } });
    const closes = bars.map((bar) => bar.close);
    candle.setData(
      bars.map((bar) => ({
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    ma4.setData(
      bars.flatMap((bar, i) => {
        const value = maAt(closes, 4, i);
        return value == null ? [] : [{ time: bar.time as Time, value }];
      }),
    );
    requestAnimationFrame(() => chart.timeScale().fitContent());
  }, [bars, digits]);

  return <div ref={boxRef} className="h-[220px] w-full" />;
}
