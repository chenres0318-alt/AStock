import type { KBar } from "./types";

export type QuotesInstrument = {
  code: string;
  name: string;
  source: "tencent" | "sina";
  sinaSymbol?: string;
  digits?: number;
};

/** 行情页指数，银行指数只列一次。科创 / 创业分开看。 */
export const QUOTES_INSTRUMENTS: QuotesInstrument[] = [
  { code: "usIXIC", name: "纳斯达克指数", source: "tencent" },
  { code: "usINX", name: "标普指数", source: "tencent" },
  { code: "sh000300", name: "沪深300", source: "tencent" },
  { code: "sh000688", name: "科创50", source: "tencent" },
  { code: "sz399006", name: "创业板指", source: "tencent" },
  { code: "GC", name: "黄金", source: "sina", sinaSymbol: "GC", digits: 2 },
  { code: "sh000922", name: "红利指数", source: "tencent" },
  { code: "sz399986", name: "银行指数", source: "tencent" },
  { code: "CL", name: "石油", source: "sina", sinaSymbol: "CL", digits: 2 },
  { code: "NK", name: "日经225", source: "sina", sinaSymbol: "NK" },
];

export function quotesInstrument(code: string): QuotesInstrument | undefined {
  const raw = code.trim();
  return QUOTES_INSTRUMENTS.find((item) => item.code.toLowerCase() === raw.toLowerCase());
}

function maAt(closes: number[], period: number, index: number): number | null {
  if (index < period - 1 || index >= closes.length) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += closes[i];
  return sum / period;
}

/** 周 K 最新一根呈 MA4>MA7>MA10。 */
export function weekMaStacked(bars: KBar[] | null | undefined): boolean {
  if (!bars || bars.length < 10) return false;
  const closes = bars.map((bar) => bar.close);
  const last = closes.length - 1;
  const ma4 = maAt(closes, 4, last);
  const ma7 = maAt(closes, 7, last);
  const ma10 = maAt(closes, 10, last);
  return ma4 != null && ma7 != null && ma10 != null && ma4 > ma7 && ma7 > ma10;
}

/** 周 K 已呈 MA4>MA7>MA10 的排前面，其余保持原顺序。 */
export function sortQuotesByWeekStack<T>(items: readonly T[], stacked: (item: T) => boolean): T[] {
  const ranked = items.map((item, index) => ({ item, index, on: stacked(item) }));
  ranked.sort((a, b) => Number(b.on) - Number(a.on) || a.index - b.index);
  return ranked.map((row) => row.item);
}
