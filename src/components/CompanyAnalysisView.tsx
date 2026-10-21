"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { displaySymbol, priceDigits, toTencentCode } from "@/lib/codes";
import type { CompanyAnalysis } from "@/lib/companyAnalysis";
import { formatAmount, formatPct, formatPrice, toneClass } from "@/lib/format";
import type { SearchItem } from "@/lib/types";
import AppHeader from "./AppHeader";
import { EmptyHint } from "./ui";

async function readJson<T>(url: string, timeoutMs = 45_000): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function riskTone(level: string): string {
  if (level === "high" || level === "bad") return "text-up";
  if (level === "mid" || level === "watch") return "text-gold";
  return "text-down";
}

function riskLabel(level: string): string {
  if (level === "high" || level === "bad") return "高";
  if (level === "mid" || level === "watch") return "需关注";
  if (level === "ok") return "未见明显异常";
  return "较低";
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2">
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`mt-1 num text-sm ${toneClass(tone)}`}>{value}</div>
    </div>
  );
}

export default function CompanyAnalysisView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [keyword, setKeyword] = useState(initial);
  const [hits, setHits] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<CompanyAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKeyword(initial);
    if (!initial.trim()) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    readJson<CompanyAnalysis>(`/api/market/analyze?q=${encodeURIComponent(initial)}`)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setReport(null);
          setError(err instanceof Error ? err.message : "分析失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  useEffect(() => {
    const q = keyword.trim();
    if (!q || q === initial) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await readJson<{ items: SearchItem[] }>(`/api/market/search?q=${encodeURIComponent(q)}`, 15_000);
        setHits(data.items ?? []);
        setOpen(true);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [keyword, initial]);

  const submit = (value: string) => {
    const next = value.trim();
    if (!next) return;
    setOpen(false);
    router.push(`/analyze?q=${encodeURIComponent(next)}`);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(keyword);
  };

  const digits = report?.quote ? priceDigits(report.quote.code, report.quote.name) : 2;
  const recentReduce = report?.holdChanges.filter((item) => item.side === "reduce").slice(0, 8) ?? [];
  const upcomingLifts = report?.lifts.filter((item) => item.upcoming).slice(0, 8) ?? [];
  const pastLifts = report?.lifts.filter((item) => !item.upcoming).slice(0, 4) ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1100px] flex-col gap-3 p-3">
      <AppHeader />
      <section className="panel px-4 py-4">
        <div className="text-sm">公司分析</div>
        <div className="mt-1 max-w-3xl text-xs leading-5 text-mute">
          输入股票公司名称或代码。看基本面、估值、买入风险，以及股东减持、限售解禁、定向增发和经营是否异常。数据来自公开行情和东财 F10，只供学习，不构成投资建议。
        </div>
        <form className="relative mt-3 max-w-xl" onSubmit={onSubmit}>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onFocus={() => hits.length && setOpen(true)}
            placeholder="例如 立讯精密 / 工业富联 / 002475"
            className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-mute focus:border-gold/60"
          />
          {open && hits.length ? (
            <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-panel-2 shadow-xl scroll-thin">
              {hits.map((hit) => (
                <button
                  key={hit.code}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-panel"
                  onClick={() => submit(hit.name)}
                >
                  <span>
                    {hit.name}
                    <span className="ml-2 text-xs text-mute">{displaySymbol(hit.code)}</span>
                  </span>
                  <span className="text-[10px] text-gold">{hit.typeName}</span>
                </button>
              ))}
            </div>
          ) : null}
        </form>
      </section>

      {error ? <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div> : null}
      {loading ? <div className="panel px-4 py-10 text-center text-sm text-mute">正在读取公司资料…</div> : null}
      {!loading && !report && !error ? <EmptyHint text="输入公司名称后开始分析" /> : null}

      {report ? (
        <>
          <section className="panel px-4 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-lg">{report.company.shortName}</div>
                <div className="text-[11px] text-mute">
                  {displaySymbol(report.search.code)} · {report.company.listing} · {report.company.industry}
                </div>
                <div className="mt-1 text-xs text-mute">{report.company.fullName}</div>
              </div>
              <div className="text-right">
                <div className={`num text-2xl ${toneClass(report.quote?.pct)}`}>
                  {formatPrice(report.quote?.price, digits)}
                </div>
                <div className={`num text-sm ${toneClass(report.quote?.pct)}`}>{formatPct(report.quote?.pct)}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full bg-panel-2 px-2 py-1 ${riskTone(report.buyRisk.level)}`}>
                买入风险 {riskLabel(report.buyRisk.level)}
              </span>
              <span className={`rounded-full bg-panel-2 px-2 py-1 ${riskTone(report.operation.level)}`}>
                经营 {riskLabel(report.operation.level)}
              </span>
              <Link href={`/?code=${toTencentCode(report.search.code)}`} className="rounded-full bg-gold px-2 py-1 text-bg">
                打开看盘
              </Link>
            </div>
            <p className="mt-3 text-xs leading-6 text-mute">{report.company.intro.slice(0, 280)}{report.company.intro.length > 280 ? "…" : ""}</p>
            <div className="mt-2 text-[11px] text-mute">
              董事长 {report.company.chairman} · 注册资本 {report.company.capital} · 员工 {report.company.staff} · {report.company.website}
            </div>
            <div className="mt-2 text-xs text-mute">经营范围：{report.company.business}</div>
          </section>

          <section className="panel px-4 py-4">
            <div className="text-sm">基本面 · {report.fundamentals.report}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="营业总收入" value={formatAmount(report.fundamentals.revenue)} />
              <Metric label="收入同比" value={formatPct(report.fundamentals.revenueYoy)} tone={report.fundamentals.revenueYoy} />
              <Metric label="归属净利润" value={formatAmount(report.fundamentals.profit)} />
              <Metric label="净利润同比" value={formatPct(report.fundamentals.profitYoy)} tone={report.fundamentals.profitYoy} />
              <Metric label="每股收益" value={formatPrice(report.fundamentals.eps)} />
              <Metric label="每股净资产" value={formatPrice(report.fundamentals.bps)} />
              <Metric label="净资产收益率" value={formatPct(report.fundamentals.roe)} tone={report.fundamentals.roe} />
              <Metric label="销售毛利率" value={formatPct(report.fundamentals.margin)} />
              <Metric label="资产负债率" value={formatPct(report.fundamentals.debt)} />
              <Metric label="股东户数" value={report.fundamentals.holders == null ? "--" : report.fundamentals.holders.toLocaleString("zh-CN")} />
              <Metric label="持股集中度" value={report.fundamentals.holderFocus} />
            </div>
          </section>

          <section className="panel px-4 py-4">
            <div className="text-sm">估值</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="滚动市盈率" value={formatPrice(report.valuation.peTtm, 1)} />
              <Metric label="动态市盈率" value={formatPrice(report.valuation.peDynamic, 1)} />
              <Metric label="静态市盈率" value={formatPrice(report.valuation.peStatic, 1)} />
              <Metric label="市净率" value={formatPrice(report.valuation.pb, 2)} />
              <Metric label="总市值" value={formatAmount(report.valuation.totalMvYi != null ? report.valuation.totalMvYi * 1e8 : null)} />
              <Metric
                label={report.valuation.forecastOrg ? `${report.valuation.forecastOrg}预测市盈率` : "机构预测市盈率"}
                value={formatPrice(report.valuation.forecastPe, 1)}
              />
            </div>
          </section>

          <section className="panel px-4 py-4">
            <div className="text-sm">买入风险</div>
            <ul className="mt-2 space-y-1 text-sm">
              {report.buyRisk.flags.map((item) => (
                <li key={item.text} className={riskTone(item.level)}>
                  {item.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel px-4 py-4">
            <div className="text-sm">经营是否异常</div>
            <ul className="mt-2 space-y-1 text-sm">
              {report.operation.flags.map((item) => (
                <li key={item.text} className={riskTone(item.level)}>
                  {item.text}
                </li>
              ))}
            </ul>
            {report.events.length ? (
              <div className="mt-3 space-y-1 text-xs text-mute">
                {report.events.slice(0, 6).map((item) => (
                  <div key={`${item.date}-${item.title}`}>
                    {item.date} · {item.type} · {item.title}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <div className="grid gap-3 lg:grid-cols-3">
            <section className="panel px-4 py-4">
              <div className="text-sm">股东减持</div>
              {recentReduce.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {recentReduce.map((item, index) => (
                    <li key={`${item.date}-${item.holder}-${index}`}>
                      <div>
                        {item.holder}
                        <span className="ml-2 text-up">减持</span>
                      </div>
                      <div className="text-[11px] text-mute">
                        {item.date} · {item.reason} · {item.shares == null ? "--" : `${item.shares.toLocaleString("zh-CN")}股`}
                        {item.amountWan != null ? ` · ${item.amountWan.toFixed(2)}万元` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyHint text="近半年公开记录里没有董监高减持" />
              )}
            </section>
            <section className="panel px-4 py-4">
              <div className="text-sm">限售解禁</div>
              {upcomingLifts.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {upcomingLifts.map((item) => (
                    <li key={`${item.date}-${item.type}`}>
                      <div>{item.date}</div>
                      <div className="text-[11px] text-mute">
                        {item.type} · {item.sharesWan == null ? "--" : `${item.sharesWan.toFixed(2)}万股`}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyHint text="没有尚未解禁的限售记录" />
              )}
              {pastLifts.length ? (
                <div className="mt-3 text-[11px] text-mute">
                  最近已解禁：{pastLifts.map((item) => `${item.date} ${item.type}`).join("；")}
                </div>
              ) : null}
            </section>
            <section className="panel px-4 py-4">
              <div className="text-sm">定向增发</div>
              {report.seos.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {report.seos.slice(0, 6).map((item, index) => (
                    <li key={`${item.date}-${index}`}>
                      <div>{item.date ?? "尚未上市"} · {item.way}</div>
                      <div className="text-[11px] text-mute">
                        价格 {formatPrice(item.price)} · 募资 {item.raiseYi == null ? "--" : `${item.raiseYi.toFixed(2)}亿`}
                      </div>
                      {item.objects ? <div className="mt-1 text-[11px] leading-5 text-mute">{item.objects}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyHint text="没有定向增发记录" />
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
