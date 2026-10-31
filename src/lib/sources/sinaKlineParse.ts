import type { KBar } from "../types";

type SinaFutRow = {
  date?: string;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
  volume?: string | number;
};

function toNumber(value: unknown): number | null {
  if (value == null || value === "" || value === "-" || value === "--") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function barFromObject(row: SinaFutRow): KBar | null {
  const time = String(row.date ?? "").slice(0, 10);
  const open = toNumber(row.open);
  const high = toNumber(row.high);
  const low = toNumber(row.low);
  const close = toNumber(row.close);
  const volume = toNumber(row.volume) ?? 0;
  if (!time || open == null || high == null || low == null || close == null) return null;
  return { time, open, high, low, close, volume };
}

function barFromArray(row: unknown[]): KBar | null {
  if (row.length < 5) return null;
  const time = String(row[0] ?? "").slice(0, 10);
  const open = toNumber(row[1]);
  const high = toNumber(row[2]);
  const low = toNumber(row[3]);
  const close = toNumber(row[4]);
  const volume = toNumber(row[5]) ?? 0;
  if (!time || open == null || high == null || low == null || close == null) return null;
  return { time, open, high, low, close, volume };
}

export function parseSinaFuturesKline(raw: unknown): KBar[] {
  if (!Array.isArray(raw)) return [];
  const bars: KBar[] = [];
  for (const row of raw) {
    const bar = Array.isArray(row) ? barFromArray(row) : barFromObject(row as SinaFutRow);
    if (bar) bars.push(bar);
  }
  return bars;
}
