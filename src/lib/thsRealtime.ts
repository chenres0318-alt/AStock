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

export function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 现价明显高于前复权收盘时，多半是未复权行情，不能叠到均线上。 */
export function alignedLivePrice(
  price: number | null | undefined,
  lastClose: number | null | undefined,
): number | null {
  if (price == null || !(price > 0)) return null;
  if (lastClose == null || !(lastClose > 0)) return price;
  if (price > lastClose * 1.25) return null;
  return price;
}

/** 把成分股现价接到日 K：同一天替换收盘，新的交易日补一根。周末不补。 */
export function withLiveClose(
  bars: KBar[],
  price: number | null | undefined,
  today?: string | null,
): KBar[] {
  if (!bars.length) return bars;
  const last = bars[bars.length - 1];
  const spot = alignedLivePrice(price, last.close);
  if (spot == null) return bars;
  const session = today && !isShanghaiWeekend(today) ? today : last.time;
  if (session < last.time) return bars;
  const live: KBar =
    session === last.time
      ? {
          ...last,
          close: spot,
          high: Math.max(last.high, spot),
          low: Math.min(last.low, spot),
        }
      : {
          time: session,
          open: last.close,
          high: Math.max(last.close, spot),
          low: Math.min(last.close, spot),
          close: spot,
          volume: 0,
          turnover: null,
        };
  return withToday(bars, live);
}
