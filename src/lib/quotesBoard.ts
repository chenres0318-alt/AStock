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
