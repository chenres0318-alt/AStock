import type { Market, WatchItem } from "./types";

export const INDICES: WatchItem[] = [
  { code: "sh000001", name: "上证指数" },
  { code: "sz399001", name: "深证成指" },
  { code: "sz399006", name: "创业板指" },
  { code: "sh000688", name: "科创50" },
  { code: "sh000300", name: "沪深300" },
  { code: "sh000905", name: "中证500" },
];

export const DEFAULT_WATCHLIST: WatchItem[] = [
  { code: "sh600519", name: "贵州茅台" },
  { code: "sz000858", name: "五粮液" },
  { code: "sz300750", name: "宁德时代" },
  { code: "sz002594", name: "比亚迪" },
  { code: "sh600036", name: "招商银行" },
  { code: "sh601318", name: "中国平安" },
  { code: "sh688981", name: "中芯国际" },
  { code: "sz300059", name: "东方财富" },
  { code: "sz002475", name: "立讯精密" },
  { code: "sz000333", name: "美的集团" },
  { code: "sh601899", name: "紫金矿业" },
  { code: "sz300308", name: "中际旭创" },
];

export const SECTOR_ETFS: WatchItem[] = [
  { code: "sh512480", name: "半导体" },
  { code: "sz159819", name: "人工智能" },
  { code: "sh512880", name: "证券" },
  { code: "sh512800", name: "银行" },
  { code: "sh515790", name: "光伏" },
  { code: "sz159992", name: "创新药" },
  { code: "sh512690", name: "酒" },
  { code: "sh512660", name: "军工" },
  { code: "sz159825", name: "农业" },
  { code: "sh516160", name: "新能源" },
];

const INDEX_CODES = new Set(INDICES.map((item) => item.code));

export function bareCode(input: string): string {
  const raw = input.trim().toLowerCase();
  const dotted = raw.match(/^(?:sh|sz|bj)?[a-z]*\.?(\d{6})$/);
  if (dotted) return dotted[1];
  const em = raw.match(/^[013]\.(\d{6})$/);
  if (em) return em[1];
  const digits = raw.match(/(\d{6})/);
  return digits ? digits[1] : raw.replace(/^[a-z]+/, "");
}

export function marketOf(input: string): Market {
  const raw = input.trim().toLowerCase();
  if (raw.startsWith("sh") || raw.startsWith("1.")) return "SH";
  if (raw.startsWith("sz") || raw.startsWith("0.")) return "SZ";
  if (raw.startsWith("bj") || raw.startsWith("2.")) return "BJ";

  const code = bareCode(raw);
  if (code.startsWith("92") || code.startsWith("8") || code.startsWith("4")) {
    return "BJ";
  }
  if (
    code.startsWith("6") ||
    code.startsWith("5") ||
    code.startsWith("9") ||
    code.startsWith("000688") ||
    code.startsWith("000300") ||
    code.startsWith("000905") ||
    code.startsWith("000016") ||
    code.startsWith("000001") && raw.includes("sh")
  ) {
    return "SH";
  }
  return "SZ";
}

export function toTencentCode(input: string): string {
  const raw = input.trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) return raw;
  const code = bareCode(raw);
  if (INDEX_CODES.has(`sh${code}`) && (raw.includes("sh") || raw.startsWith("1."))) {
    return `sh${code}`;
  }
  if (code === "000001" && (raw.startsWith("1.") || raw.includes("sh"))) {
    return "sh000001";
  }
  const market = marketOf(raw);
  const prefix = market === "SH" ? "sh" : market === "SZ" ? "sz" : "bj";
  if (code === "000001" && market === "SH") return "sh000001";
  if (code === "000001") return "sz000001";
  return `${prefix}${code}`;
}

export function toSinaCode(input: string): string {
  return toTencentCode(input);
}

export function toEastMoneySecId(input: string): string {
  const code = toTencentCode(input);
  const market = marketOf(code);
  const num = market === "SH" ? "1" : "0";
  return `${num}.${bareCode(code)}`;
}

export function marketLabel(code: string): string {
  const tx = toTencentCode(code);
  const id = bareCode(tx);
  if (id.startsWith("688") || id.startsWith("689")) return "科创";
  if (id.startsWith("300") || id.startsWith("301")) return "创业";
  if (marketOf(tx) === "BJ") return "北证";
  if (INDEX_CODES.has(tx) || id.startsWith("399") || id.startsWith("000")) {
    if (INDEX_CODES.has(tx)) return "指数";
  }
  return marketOf(tx) === "SH" ? "沪A" : "深A";
}

export function displaySymbol(code: string): string {
  const tx = toTencentCode(code);
  return `${bareCode(tx)}.${marketOf(tx)}`;
}

export function limitPercent(code: string, name = ""): number {
  const upper = name.toUpperCase();
  if (upper.includes("ST") || name.includes("退")) return 5;
  const id = bareCode(code);
  if (id.startsWith("300") || id.startsWith("301") || id.startsWith("688") || id.startsWith("689")) {
    return 20;
  }
  if (id.startsWith("8") || id.startsWith("4") || id.startsWith("92")) return 30;
  return 10;
}

export function isStName(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.includes("ST") || name.includes("退");
}

export function isHsAShare(code: string, name = ""): boolean {
  if (isStName(name)) return false;
  const tx = toTencentCode(code);
  if (marketOf(tx) === "BJ") return false;
  const id = bareCode(tx);
  return /^(60|68|00|30)\d{4}$/.test(id);
}

export function isListedStockCode(code: string): boolean {
  return /^(sh|sz|bj)\d{6}$/i.test(code.trim());
}

export function isIndexCode(code: string): boolean {
  const tx = toTencentCode(code);
  if (INDEX_CODES.has(tx)) return true;
  const id = bareCode(tx);
  return id.startsWith("399") || (id.startsWith("000") && marketOf(tx) === "SH");
}
