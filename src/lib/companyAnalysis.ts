import { isEtf, isIndexCode, marketLabel, toTencentCode } from "./codes";
import { toNumber } from "./format";
import { cached } from "./cache";
import { getSearch } from "./market";
import {
  fetchEastMoneyCompanyNews,
  fetchEastMoneyCompanySurvey,
  fetchEastMoneyF10Ops,
  fetchEastMoneyHoldChanges,
  fetchEastMoneySeos,
  fetchEastMoneyShareLifts,
} from "./sources/eastmoney";
import { fetchTencentQuotes } from "./sources/tencent";
import type { Quote, SearchItem } from "./types";
import {
  fromMillis,
  holdSide,
  judgeBuyRisk,
  judgeOperation,
  pickSentiment,
  shanghaiToday,
  shiftYmd,
  stripHtml,
  ymd,
} from "./companyAnalysisLogic";
import type { AnalysisFlag, SentimentItem } from "./companyAnalysisLogic";

export type { AnalysisFlag, SentimentItem };
export {
  aboutCompany,
  classifySentiment,
  holdSide,
  judgeBuyRisk,
  judgeOperation,
  pickSentiment,
  shanghaiToday,
  shiftYmd,
  stripHtml,
  ymd,
} from "./companyAnalysisLogic";

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
  bullish: SentimentItem[];
  bearish: SentimentItem[];
  buyRisk: { level: "low" | "mid" | "high"; flags: AnalysisFlag[] };
  operation: { level: "ok" | "watch" | "bad"; flags: AnalysisFlag[] };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

  return cached(`analyze:${code}:v4`, 5 * 60_000, async () => {
    const [quoteRes, opsRes, surveyRes, holdsRes, liftsRes, seosRes, newsRes] = await Promise.allSettled([
      fetchTencentQuotes([code]),
      fetchEastMoneyF10Ops(code),
      fetchEastMoneyCompanySurvey(code),
      fetchEastMoneyHoldChanges(code),
      fetchEastMoneyShareLifts(code),
      fetchEastMoneySeos(code),
      fetchEastMoneyCompanyNews(picked.name),
    ]);
    const quote = settled(quoteRes, [] as Quote[])[0] ?? null;
    const name = quote?.name || picked.name;
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
    const { bullish, bearish } = pickSentiment(
      [
        ...events.map((item) => ({
          date: item.date,
          title: item.title,
          summary: item.type,
          source: "event" as const,
        })),
        ...notices.map((item) => ({
          date: item.date,
          title: item.title,
          summary: "公司公告",
          source: "notice" as const,
        })),
        ...settled(newsRes, [] as Array<Record<string, unknown>>).map((row) => ({
          date: ymd(row.date),
          title: stripHtml(row.title),
          summary: stripHtml(row.content).slice(0, 90),
          source: "news" as const,
        })),
        ...asList(asRecord(asRecord(ops.zxzx).data).items).map((item) => {
          const row = asRecord(item);
          return {
            date: fromMillis(row.showDateTime),
            title: stripHtml(row.title),
            summary: stripHtml(row.summary).slice(0, 90),
            source: "news" as const,
          };
        }),
        ...holdChanges
          .filter((item) => item.side !== "other" && item.date != null && item.date >= shiftYmd(today, -6))
          .map((item) => ({
            date: item.date,
            title: `${item.holder}${item.side === "reduce" ? "减持" : "增持"}${
              item.shares == null ? "" : ` ${item.shares.toLocaleString("zh-CN")}股`
            }`,
            summary: item.reason,
            source: "hold" as const,
          })),
        ...lifts
          .filter((item) => item.upcoming && item.date != null && item.date <= shiftYmd(today, 3))
          .map((item) => ({
            date: item.date,
            title: `${item.type || "限售股"}解禁${item.sharesWan == null ? "" : ` ${item.sharesWan.toFixed(2)}万股`}`,
            summary: "未来三个月限售解禁",
            source: "lift" as const,
          })),
      ],
      name,
      code,
    );
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
      bullish,
      bearish,
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
