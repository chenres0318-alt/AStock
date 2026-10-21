export type AnalysisFlag = {
  level: "low" | "mid" | "high";
  text: string;
};

export type SentimentItem = {
  date: string | null;
  title: string;
  summary: string;
  source: "event" | "notice" | "news" | "hold" | "lift";
  side: "bull" | "bear";
};

export function ymd(value: unknown): string | null {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function fromMillis(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n) && n > 1e12) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(n));
  }
  return ymd(value);
}

export function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function shiftYmd(value: string, months: number): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCMonth(date.getUTCMonth() + months);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRiskName(name: string): boolean {
  return name.toUpperCase().includes("ST") || name.includes("退");
}

function codeDigits(code: string): string {
  const match = code.match(/(\d{6})/);
  return match ? match[1] : "";
}

export function holdSide(reason: string, shares: number | null): "reduce" | "increase" | "other" {
  if (/减持|竞价|大宗/.test(reason) || (shares != null && shares < 0)) return "reduce";
  if (/增持|股权激励|买入/.test(reason) || (shares != null && shares > 0)) return "increase";
  return "other";
}

export function judgeBuyRisk(input: {
  name: string;
  profitYoy: number | null;
  debt: number | null;
  peTtm: number | null;
  recentReduce: boolean;
  upcomingLift: boolean;
  pendingSeo: boolean;
  eventHits: string[];
}): { level: "low" | "mid" | "high"; flags: AnalysisFlag[] } {
  const flags: AnalysisFlag[] = [];
  if (isRiskName(input.name) || input.name.includes("退")) {
    flags.push({ level: "high", text: "名称带 ST 或退市提示，买入风险高" });
  }
  if (input.eventHits.some((item) => /立案|退市|风险警示|处罚/.test(item))) {
    flags.push({ level: "high", text: "大事提醒里有立案、处罚或退市相关事项" });
  }
  if (input.recentReduce) flags.push({ level: "mid", text: "近半年有董监高或股东减持" });
  if (input.upcomingLift) flags.push({ level: "mid", text: "未来三个月有限售解禁" });
  if (input.pendingSeo) flags.push({ level: "mid", text: "有尚未完成或较新的定向增发" });
  if (input.profitYoy != null && input.profitYoy < -30) {
    flags.push({ level: "mid", text: "归属净利润同比下滑超过 30%" });
  }
  if (input.debt != null && input.debt >= 70) flags.push({ level: "mid", text: "资产负债率在 70% 及以上" });
  if (input.peTtm != null && input.peTtm > 80) flags.push({ level: "mid", text: "滚动市盈率偏高" });
  if (!flags.length) flags.push({ level: "low", text: "公开数据里没有明显的买入阻断项" });
  const level = flags.some((item) => item.level === "high") ? "high" : flags.some((item) => item.level === "mid") ? "mid" : "low";
  return { level, flags };
}

export function judgeOperation(input: {
  name: string;
  profitYoy: number | null;
  eventHits: string[];
}): { level: "ok" | "watch" | "bad"; flags: AnalysisFlag[] } {
  const flags: AnalysisFlag[] = [];
  if (isRiskName(input.name) || /退市|立案调查/.test(input.eventHits.join(" "))) {
    flags.push({ level: "high", text: "经营或监管状态异常" });
  }
  if (input.eventHits.some((item) => /亏损|预减|下滑/.test(item))) {
    flags.push({ level: "mid", text: "业绩预告偏弱" });
  }
  if (input.profitYoy != null && input.profitYoy < 0) {
    flags.push({ level: "mid", text: "最新报告期净利润同比下降" });
  }
  if (!flags.length) flags.push({ level: "low", text: "最新报告期和大事提醒里未见明显经营异常" });
  const level = flags.some((item) => item.level === "high") ? "bad" : flags.some((item) => item.level === "mid") ? "watch" : "ok";
  return { level, flags };
}

const SKIP_SENTIMENT =
  /报表披露|董事会会议|投资者关系|融资融券|股东户数|投资互动|英文版|恢复转股|转股价格|召开日期|风险持续评估|半年度报告|年度报告|季度报告(?!.*预)/;
const BEAR_SENTIMENT =
  /立案|调查|337|处罚|警示函|问询函|监管函|违规|诉讼|仲裁|冻结|预减|预亏|亏损|业绩变脸|减持|解禁|退市|风险警示|终止合作|否决|下调评级|裁员|停产|召回|好仓.{0,8}下降|同比下降|净利润下滑|业绩下滑/;
const BULL_SENTIMENT =
  /预增|略增|扭亏|超预期|大增|增长|同比上升|回购|增持|分红|派息|送转|权益分派|中标|战略合作|获批|股权激励|好仓.{0,8}上升|上调评级|买入评级|量产|订单饱满/;
const STRONG_BEAR = /立案|调查|337|处罚|预减|预亏|亏损|减持|退市/;

export function stripHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySentiment(text: string): "bull" | "bear" | "neutral" {
  const t = stripHtml(text).replace(/\s+/g, "");
  if (!t || SKIP_SENTIMENT.test(t)) return "neutral";
  const bear = BEAR_SENTIMENT.test(t);
  const bull = BULL_SENTIMENT.test(t);
  if (bear && bull) return STRONG_BEAR.test(t) ? "bear" : "bull";
  if (bear) return "bear";
  if (bull) return "bull";
  return "neutral";
}

export function aboutCompany(title: string, summary: string, name: string, code: string): boolean {
  const cleanTitle = stripHtml(title);
  const cleanSummary = stripHtml(summary);
  const id = codeDigits(code);
  const blob = `${cleanTitle} ${cleanSummary}`;
  const named = Boolean(name && blob.includes(name));
  const coded = Boolean(id && blob.includes(id));
  if (!named && !coded) return false;
  const head = cleanTitle.match(/^(.{2,12}?)[：:]/);
  if (!head) return true;
  const lead = head[1];
  if ((name && lead === name) || (id && lead === id)) return true;
  if (/公告|新闻|快讯|资讯|大宗交易|主力资金|市场/.test(lead)) return true;
  return Boolean((name && lead.includes(name)) || (id && lead.includes(id)));
}

function fingerprint(title: string, name: string): string {
  return stripHtml(title)
    .replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .replace(/\d{6}/g, "")
    .replace(/发布公告|关于|的公告|公司/g, "")
    .replace(/[^\u4e00-\u9fffA-Za-z]/g, "")
    .slice(0, 24);
}

const THEME_RE = /337|回购|减持|调查|立案|分红|权益分派|预增|略增|解禁|增持/;

function themeKey(text: string, date: string | null): string | null {
  const hit = stripHtml(text).match(THEME_RE);
  return hit ? `${date ?? ""}:${hit[0]}` : null;
}

const SOURCE_RANK: Record<SentimentItem["source"], number> = {
  event: 0,
  notice: 1,
  hold: 2,
  lift: 3,
  news: 4,
};

export function pickSentiment(
  items: Array<{ date: string | null; title: string; summary?: string; source: SentimentItem["source"] }>,
  name: string,
  code: string,
): { bullish: SentimentItem[]; bearish: SentimentItem[] } {
  const seen = new Set<string>();
  const bullish: SentimentItem[] = [];
  const bearish: SentimentItem[] = [];
  const sorted = [...items].sort((a, b) => {
    const byDate = String(b.date ?? "").localeCompare(String(a.date ?? ""));
    if (byDate) return byDate;
    return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  });
  for (const item of sorted) {
    const title = stripHtml(item.title);
    const summary = stripHtml(item.summary ?? "");
    if (!title) continue;
    if (item.source === "news" && !aboutCompany(title, summary, name, code)) continue;
    const side = classifySentiment(`${title} ${summary}`);
    if (side === "neutral") continue;
    const key = fingerprint(title, name);
    if (!key || seen.has(key)) continue;
    const theme = themeKey(`${title}${summary}`, item.date);
    if (item.source === "news" && theme && seen.has(theme)) continue;
    seen.add(key);
    if (theme) seen.add(theme);
    const row: SentimentItem = { date: item.date, title, summary, source: item.source, side };
    if (side === "bull") {
      if (bullish.length < 8) bullish.push(row);
    } else if (bearish.length < 8) {
      bearish.push(row);
    }
  }
  return { bullish, bearish };
}
