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

export function adviseHolding(input: {
  stockOnMa4: boolean;
  sectorOnMa4: boolean;
  sectorInRedBox: boolean;
  hasSector: boolean;
  sectorResolved: boolean;
  standDays?: number | null;
  stockCloseDown?: boolean;
  sectorCloseDown?: boolean;
}): HoldingAdvice {
  const sectorKnown = input.hasSector && input.sectorResolved;
  const stockCloseDown = Boolean(input.stockCloseDown);
  const sectorCloseDown = Boolean(input.sectorCloseDown);
  const bothBroken = sectorKnown && !input.stockOnMa4 && !input.sectorOnMa4;
  const bothLower = stockCloseDown && sectorCloseDown;

  if (bothBroken && bothLower) {
    return {
      action: "exit",
      label: "需要离场",
      stockOnMa4: false,
      sectorOnMa4: false,
      sectorInRedBox: input.sectorInRedBox,
      notes: ["股价收盘跌破MA4且低于昨日", "板块指数跌破MA4且低于昨日"],
    };
  }

  const notes: string[] = [];
  if (input.stockOnMa4) {
    notes.push(input.standDays ? `个股站上MA4共${input.standDays}日` : "个股站上MA4");
  } else {
    notes.push(stockCloseDown ? "股价收盘跌破MA4且低于昨日" : "股价收盘跌破MA4");
    if (!stockCloseDown) notes.push("股价收盘未低于昨日");
  }
  if (!input.hasSector) {
    notes.push("缺少所属板块，板块指数未核对");
  } else if (!input.sectorResolved) {
    notes.push("板块指数暂无法核对");
  } else if (input.sectorOnMa4) {
    notes.push("板块指数站上MA4");
  } else {
    notes.push(sectorCloseDown ? "板块指数跌破MA4且低于昨日" : "板块指数跌破MA4");
    if (!sectorCloseDown) notes.push("板块指数收盘未低于昨日");
  }

  return {
    action: "hold",
    label: "继续持仓",
    stockOnMa4: input.stockOnMa4,
    sectorOnMa4: sectorKnown ? input.sectorOnMa4 : false,
    sectorInRedBox: input.sectorInRedBox,
    notes,
  };
}
