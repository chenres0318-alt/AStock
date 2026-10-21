import { isEtf, isIndexCode, isStName, marketLabel, toTencentCode } from "./codes";
import { shanghaiParts, toNumber } from "./format";
import { cached } from "./cache";
import { getSearch } from "./market";
import {
  fetchEastMoneyCompanySurvey,
  fetchEastMoneyF10Ops,
  fetchEastMoneyHoldChanges,
  fetchEastMoneySeos,
  fetchEastMoneyShareLifts,
} from "./sources/eastmoney";
import { fetchTencentQuotes } from "./sources/tencent";
import type { Quote, SearchItem } from "./types";

export type AnalysisFlag = {
  level: "low" | "mid" | "high";
  text: string;
};

export type HoldChangeRow = {
  date: string | null;
  holder: string;
  reason: string;
  shares: number | null;
  amountWan: number | null;
  side: "reduce" | "increase" | "other";
};

export type LiftRow = {
  date: string | null;
  type: string;
  sharesWan: number | null;
  capYi: number | null;
  upcoming: boolean;
};

export type SeoRow = {
  date: string | null;
  way: string;
  price: number | null;
  shares: number | null;
  raiseYi: number | null;
  objects: string;
};

export type CompanyAnalysis = {
  quote: Quote | null;
  search: SearchItem;
  company: {
    fullName: string;
    shortName: string;
    industry: string;
    listing: string;
    chairman: string;
    business: string;
    intro: string;
    capital: string;
    staff: string;
    website: string;
  };
  fundamentals: {
    report: string;
    revenue: number | null;
    revenueYoy: number | null;
    profit: number | null;
    profitYoy: number | null;
    eps: number | null;
    bps: number | null;
    roe: number | null;
    margin: number | null;
    debt: number | null;
    holders: number | null;
    holderFocus: string;
  };
  valuation: {
    peTtm: number | null;
    peDynamic: number | null;
    peStatic: number | null;
    pb: number | null;
    totalMvYi: number | null;
    forecastPe: number | null;
    forecastOrg: string;
  };
  events: Array<{ date: string | null; type: string; title: string }>;
  notices: Array<{ date: string | null; title: string }>;
  holdChanges: HoldChangeRow[];
  lifts: LiftRow[];
  seos: SeoRow[];
  buyRisk: { level: "low" | "mid" | "high"; flags: AnalysisFlag[] };
  operation: { level: "ok" | "watch" | "bad"; flags: AnalysisFlag[] };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function ymd(value: unknown): string | null {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function shanghaiToday(): string {
  const parts = shanghaiParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftYmd(value: string, months: number): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCMonth(date.getUTCMonth() + months);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function firstRow(value: unknown): Record<string, unknown> {
  const list = asList(value);
  return asRecord(list[0]);
}

function textOf(value: unknown, fallback = "--"): string {
  const text = String(value ?? "").trim();
  return !text || text === "None" || text === "null" ? fallback : text;
}

function num(row: Record<string, unknown>, key: string): number | null {
  return toNumber(row[key]);
}

export function holdSide(reason: string, shares: number | null): HoldChangeRow["side"] {
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
  if (isStName(input.name) || input.name.includes("退")) {
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
  if (isStName(input.name) || /退市|立案调查/.test(input.eventHits.join(" "))) {
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

function settled<T>(value: PromiseSettledResult<T>, fallback: T): T {
  return value.status === "fulfilled" ? value.value : fallback;
}

export async function getCompanyAnalysis(keyword: string): Promise<CompanyAnalysis> {
  const raw = keyword.trim();
  if (!raw) throw new Error("请输入公司名称或股票代码");
  const hits = await getSearch(raw);
  const picked =
    hits.find((item) => item.name === raw || item.code === toTencentCode(raw)) ??
    hits.find((item) => !isIndexCode(item.code) && !isEtf(item.code, item.name)) ??
    hits[0];
  if (!picked) throw new Error("没有找到这家公司");
  const code = toTencentCode(picked.code);
  if (isIndexCode(code) || isEtf(code, picked.name)) throw new Error("请选择股票公司，而不是指数或 ETF");

  return cached(`analyze:${code}`, 5 * 60_000, async () => {
    const [quoteRes, opsRes, surveyRes, holdsRes, liftsRes, seosRes] = await Promise.allSettled([
      fetchTencentQuotes([code]),
      fetchEastMoneyF10Ops(code),
      fetchEastMoneyCompanySurvey(code),
      fetchEastMoneyHoldChanges(code),
      fetchEastMoneyShareLifts(code),
      fetchEastMoneySeos(code),
    ]);
    const quote = settled(quoteRes, [] as Quote[])[0] ?? null;
    const ops = settled(opsRes, {} as Record<string, unknown>);
    const survey = asRecord(settled(surveyRes, {} as Record<string, unknown>).jbzl);
    const zxzb = firstRow(ops.zxzb);
    const other = firstRow(ops.zxzbOther);
    const zyzb = firstRow(ops.zyzb);
    const holders = firstRow(ops.gdrs);
    const forecast = firstRow(ops.jgyc);
    const events = asList(asRecord(ops.dstx).data).flatMap((group) =>
      asList(group).map((item) => {
        const row = asRecord(item);
        return {
          date: ymd(row.NOTICE_DATE),
          type: textOf(row.EVENT_TYPE, ""),
          title: textOf(row.LEVEL1_CONTENT, textOf(row.SPECIFIC_EVENTTYPE, "")),
        };
      }),
    );
    const notices = asList(ops.zxgg).map((item) => {
      const row = asRecord(item);
      return { date: ymd(row.notice_date) ?? ymd(row.display_time), title: textOf(row.title) };
    });
    const holdChanges = settled(holdsRes, [] as Array<Record<string, unknown>>).map((row) => {
      const shares = toNumber(row.CHANGE_NUM);
      const reason = textOf(row.CHANGE_REASON, "");
      return {
        date: ymd(row.CHANGE_DATE),
        holder: textOf(row.HOLDER_NAME || row.EXECUTIVE_NAME),
        reason,
        shares,
        amountWan: toNumber(row.CHANGE_AMOUNT),
        side: holdSide(reason, shares),
      } satisfies HoldChangeRow;
    });
    const today = shanghaiToday();
    const lifts = settled(liftsRes, [] as Array<Record<string, unknown>>).map((row) => {
      const date = ymd(row.FREE_DATE);
      return {
        date,
        type: textOf(row.FREE_SHARES_TYPE),
        sharesWan: toNumber(row.CURRENT_FREE_SHARES),
        capYi: toNumber(row.LIFT_MARKET_CAP) != null ? (toNumber(row.LIFT_MARKET_CAP) as number) / 10000 : null,
        upcoming: Boolean(date && date >= today),
      } satisfies LiftRow;
    });
    const seos = settled(seosRes, [] as Array<Record<string, unknown>>).map((row) => {
      const date = ymd(row.ISSUE_LISTING_DATE) ?? ymd(row.EQUITY_RECORD_DATE);
      const raise = toNumber(row.TOTAL_RAISE_FUNDS);
      return {
        date,
        way: textOf(row.ISSUE_WAY),
        price: toNumber(row.ISSUE_PRICE),
        shares: toNumber(row.ISSUE_NUM),
        raiseYi: raise != null ? raise / 1e8 : null,
        objects: textOf(row.ISSUE_OBJECT, ""),
      } satisfies SeoRow;
    });
    const profitYoy = num(zyzb, "PARENTNETPROFITTZ") ?? num(zxzb, "PARENTNETPROFITTZ");
    const eventHits = [...events.map((item) => `${item.type}${item.title}`), ...notices.map((item) => item.title)];
    const recentReduce = holdChanges.some(
      (item) => item.side === "reduce" && item.date != null && item.date >= shiftYmd(today, -6),
    );
    const upcomingLift = lifts.some(
      (item) => item.upcoming && item.date != null && item.date <= shiftYmd(today, 3),
    );
    const pendingSeo = seos.some((item) => !item.date || item.date >= shiftYmd(today, -12));
    const name = quote?.name || picked.name;
    return {
      quote,
      search: { ...picked, code },
      company: {
        fullName: textOf(survey.gsmc, name),
        shortName: textOf(survey.agjc, name),
        industry: textOf(survey.sshy),
        listing: textOf(survey.zqlb, marketLabel(code)),
        chairman: textOf(survey.dsz || survey.zjl),
        business: textOf(survey.jyfw),
        intro: textOf(survey.gsjj).replace(/\s+/g, " "),
        capital: textOf(survey.zczb),
        staff: textOf(survey.gyrs),
        website: textOf(survey.gswz),
      },
      fundamentals: {
        report: textOf(zxzb.REPORT_TYPE, textOf(zyzb.REPORT_DATE_NAME)),
        revenue: num(zxzb, "TOTAL_OPERATEINCOME") ?? num(zyzb, "TOTALOPERATEREVE"),
        revenueYoy: num(zyzb, "TOTALOPERATEREVETZ") ?? num(zxzb, "TOTALOPERATEREVETZ"),
        profit: num(zxzb, "PARENT_NETPROFIT") ?? num(zyzb, "PARENTNETPROFIT"),
        profitYoy,
        eps: num(zxzb, "EPSJB"),
        bps: num(zxzb, "BPS"),
        roe: num(zxzb, "ROEJQ"),
        margin: num(zxzb, "XSMLL"),
        debt: num(zxzb, "ZCFZL"),
        holders: num(holders, "HOLDER_TOTAL_NUM"),
        holderFocus: textOf(holders.HOLD_FOCUS),
      },
      valuation: {
        peTtm: num(other, "PE_TTM") ?? quote?.pe ?? null,
        peDynamic: num(other, "PE_DYNAMIC"),
        peStatic: num(other, "PE_STATIC"),
        pb: num(other, "PB_MRQ_REALTIME") ?? num(other, "PB_NEW_NOTICE") ?? quote?.pb ?? null,
        totalMvYi: num(other, "TOTAL_MARKET_CAP") != null ? (num(other, "TOTAL_MARKET_CAP") as number) / 1e8 : quote?.totalMv ?? null,
        forecastPe: num(forecast, "PE1"),
        forecastOrg: textOf(forecast.ORG_NAME_ABBR, ""),
      },
      events,
      notices,
      holdChanges,
      lifts,
      seos,
      buyRisk: judgeBuyRisk({
        name,
        profitYoy,
        debt: num(zxzb, "ZCFZL"),
        peTtm: num(other, "PE_TTM"),
        recentReduce,
        upcomingLift,
        pendingSeo,
        eventHits,
      }),
      operation: judgeOperation({ name, profitYoy, eventHits }),
    };
  });
}
