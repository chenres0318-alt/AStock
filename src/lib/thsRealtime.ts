import type { KBar } from "./types";

function isoDatePrefix(value: string | undefined): string | null {
  const match = String(value ?? "").match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function isShanghaiWeekend(iso: string): boolean {
  const day = new Date(`${iso}T12:00:00+08:00`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * 实时 last.js 的 time 是北京时间时钟，收盘后跨到周末会变成周六日。
 * 交易日用 updateTime（上一根 15:00）。周末日期不当交易日。
 */
export function thsRealtimeTradeDate(items: Record<string, string | undefined>): string | null {
  const clock = isoDatePrefix(items.time);
  const updated = isoDatePrefix(items.updateTime);
  if (clock && !isShanghaiWeekend(clock)) return clock;
  if (updated && !isShanghaiWeekend(updated)) return updated;
  return null;
}

function sameOhlc(a: KBar, b: KBar): boolean {
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
}

/** 把实时这一根接到日线上。周末克隆上一交易日的不另加一根。 */
export function withToday(bars: KBar[], today: KBar | null): KBar[] {
  if (!today || isShanghaiWeekend(today.time)) return bars;
  const last = bars.at(-1);
  if (!last) return [today];
  if (today.time === last.time) return [...bars.slice(0, -1), today];
  if (today.time < last.time) return bars;
  if (sameOhlc(today, last)) return bars;
  return [...bars, today];
}
