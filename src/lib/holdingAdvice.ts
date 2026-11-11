import type { HoldingAdvice, KBar } from "./types";

function maAt(values: number[], period: number, index: number): number | null {
  if (index < period - 1 || index >= values.length) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += values[i];
  return sum / period;
}

export function closeStandsOnMa4(bars: KBar[]): boolean {
  if (bars.length < 4) return false;
  const closes = bars.map((bar) => bar.close);
  const last = closes.length - 1;
  const ma4 = maAt(closes, 4, last);
  return ma4 != null && ma4 > 0 && closes[last] >= ma4;
}

export function closeLowerThanPrev(bars: KBar[]): boolean {
  if (bars.length < 2) return false;
  const last = bars[bars.length - 1]?.close;
  const prev = bars[bars.length - 2]?.close;
  return last != null && prev != null && last < prev;
}

export function closeHigherThanPrev(bars: KBar[]): boolean {
  if (bars.length < 2) return false;
  const last = bars[bars.length - 1]?.close;
  const prev = bars[bars.length - 2]?.close;
  return last != null && prev != null && last > prev;
}

export function consecutiveMa4Days(bars: KBar[]): number {
  if (!closeStandsOnMa4(bars)) return 0;
  let days = 1;
  for (let len = bars.length - 1; len >= 4; len -= 1) {
    if (!closeStandsOnMa4(bars.slice(0, len))) break;
    days += 1;
  }
  return days;
}

export function sectorHasOpenRedBox(report: {
  bars: Array<{ time: string }>;
  trends: Array<{ status: string; end: string }>;
}): boolean {
  const lastTime = report.bars.at(-1)?.time;
  if (!lastTime) return false;
  return report.trends.some((trend) => trend.status === "open" && trend.end === lastTime);
}

export type HoldingCheckRow = { label: string; on: boolean };

/** 三项都是正面条件：红=满足，灰=不满足。灰项 ≥ 2 则离场清仓。 */
export const HOLD_EXIT_GRAY_MIN = 2;

export function holdingCheckRows(flags: {
  stockOnMa4: boolean;
  sectorInRedBox: boolean;
  conceptInRedBox: boolean;
  stockAbovePrev: boolean;
}): HoldingCheckRow[] {
  return [
    { label: "股价日K高于MA4", on: flags.stockOnMa4 },
    { label: "板块概念红框", on: flags.sectorInRedBox && flags.conceptInRedBox },
    { label: "股价高于昨日", on: flags.stockAbovePrev },
  ];
}

export function adviseHolding(input: {
  stockOnMa4: boolean;
  sectorOnMa4: boolean;
  sectorInRedBox: boolean;
  hasSector: boolean;
  sectorResolved: boolean;
  standDays?: number | null;
  stockCloseDown?: boolean;
  sectorCloseDown?: boolean;
  conceptInRedBox?: boolean;
  stockAbovePrev?: boolean;
}): HoldingAdvice {
  const stockCloseDown = Boolean(input.stockCloseDown);
  const sectorCloseDown = Boolean(input.sectorCloseDown);
  const conceptInRedBox = Boolean(input.conceptInRedBox);
  const stockAbovePrev = Boolean(input.stockAbovePrev);
  const flags = {
    stockOnMa4: input.stockOnMa4,
    sectorOnMa4: input.hasSector && input.sectorResolved ? input.sectorOnMa4 : false,
    sectorInRedBox: input.sectorInRedBox,
    conceptInRedBox,
    stockCloseDown,
    sectorCloseDown,
    stockAbovePrev,
  };
  const rows = holdingCheckRows(flags);
  const gray = rows.filter((row) => !row.on).length;
  const exit = gray >= HOLD_EXIT_GRAY_MIN;
  const notes = rows.map((row) => (row.on ? row.label : `未满足${row.label}`));
  if (!input.hasSector) notes.push("缺少所属板块，板块红框未核对");
  else if (!input.sectorResolved) notes.push("板块指数暂无法核对");

  return {
    action: exit ? "exit" : "hold",
    label: exit ? "离场清仓" : "继续持有",
    ...flags,
    notes,
  };
}
