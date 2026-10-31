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

function ma4At(closes: number[], index: number): number | null {
  if (index < 3 || index >= closes.length) return null;
  return (closes[index] + closes[index - 1] + closes[index - 2] + closes[index - 3]) / 4;
}

/** 最新一根收盘是否站上该周期的 MA4。 */
export function standsOnMa4(bars: KBar[] | null | undefined): boolean {
  if (!bars || bars.length < 4) return false;
  const closes = bars.map((bar) => bar.close);
  const last = closes.length - 1;
  const ma4 = ma4At(closes, last);
  return ma4 != null && ma4 > 0 && closes[last] >= ma4;
}

/** 日 K、周 K 收盘都站上各自的 MA4。 */
export function dayWeekStandOnMa4(day?: KBar[] | null, week?: KBar[] | null): boolean {
  return standsOnMa4(day) && standsOnMa4(week);
}

/** 日周都站上 MA4 的排前面，其余保持原顺序。 */
export function sortQuotesByMa4Stand<T>(items: readonly T[], standing: (item: T) => boolean): T[] {
  const ranked = items.map((item, index) => ({ item, index, on: standing(item) }));
  ranked.sort((a, b) => Number(b.on) - Number(a.on) || a.index - b.index);
  return ranked.map((row) => row.item);
}
