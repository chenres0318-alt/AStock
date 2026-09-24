"use client";

import { formatPct, formatPrice, toneClass } from "@/lib/format";
import { loadBuyPointBacktest, PERIODS, type PeriodKey } from "@/lib/buy-point-backtest";
import AppHeader from "./AppHeader";
import { PanelTitle } from "./ui";

const report = loadBuyPointBacktest();

function ratioPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--";
  return formatPct(value * 100, digits);
}

function ratioNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number | null;
}) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-3 ring-1 ring-line">
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`mt-1 text-xl num ${tone == null ? "" : toneClass(tone)}`}>{value}</div>
    </div>
  );
}

function PeriodCard({ label, periodKey }: { label: string; periodKey: PeriodKey }) {
  const block = report.periods[periodKey];
  const p = block.pooled;
  const dd = block.portfolio.maxDrawdown;
  return (
    <section className="panel overflow-hidden">
      <PanelTitle title={`${label}  ·  ${block.start} 至 ${block.end}`} />
      <div className="grid gap-2 px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="胜率" value={`${p.wins}/${p.tradeCount}　${ratioPct(p.winRate)}`} tone={p.winRate != null ? p.winRate - 0.5 : null} />
        <Metric label="最大回撤（20万组合）" value={ratioPct(dd)} tone={dd} />
        <Metric label="盈亏比（均盈/|均亏|）" value={ratioNum(p.payoff)} tone={p.payoff != null ? p.payoff - 1 : null} />
        <Metric label="期望值（单笔平均）" value={ratioPct(p.expectancy)} tone={p.expectancy} />
      </div>
      <div className="px-3 pb-2 text-[11px] text-mute">
        胜率 / 盈亏比 / 期望值按四只股票全部交易合计；回撤来自同一套买卖点的 20 万组合账户。组合区间收益{" "}
        {ratioPct(block.portfolio.totalReturn)}，单笔中位数 {ratioPct(p.median)}。期望值被少数连板抬高时，中位数更接近普通一笔。
      </div>
      <div className="overflow-auto scroll-thin">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-[11px] text-mute">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-normal">标的</th>
              <th className="px-3 py-2 font-normal text-right">样本</th>
              <th className="px-3 py-2 font-normal text-right">胜率</th>
              <th className="px-3 py-2 font-normal text-right">回撤</th>
              <th className="px-3 py-2 font-normal text-right">盈亏比</th>
              <th className="px-3 py-2 font-normal text-right">期望值</th>
              <th className="px-3 py-2 font-normal text-right">中位数</th>
            </tr>
          </thead>
          <tbody>
            {block.stocks.map((row) => (
              <tr key={row.code} className="border-b border-line/70">
                <td className="px-3 py-2">
                  <div>{row.name}</div>
                  <div className="text-[11px] text-mute">
                    {row.bars ? `${row.first} → ${row.last}` : "区间内无日线（未上市或停牌）"}
                  </div>
                </td>
                <td className="num px-3 py-2 text-right">{row.tradeCount}</td>
                <td className={`num px-3 py-2 text-right ${toneClass(row.winRate != null ? row.winRate - 0.5 : null)}`}>
                  {ratioPct(row.winRate)}
                </td>
                <td className={`num px-3 py-2 text-right ${toneClass(row.maxDrawdown)}`}>{ratioPct(row.maxDrawdown)}</td>
                <td className="num px-3 py-2 text-right">{ratioNum(row.payoff)}</td>
                <td className={`num px-3 py-2 text-right ${toneClass(row.expectancy)}`}>{ratioPct(row.expectancy)}</td>
                <td className={`num px-3 py-2 text-right ${toneClass(row.median)}`}>{ratioPct(row.median)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LatestTrades() {
  const rows = PERIODS.flatMap((key) =>
    report.periods[key].stocks.flatMap((stock) =>
      stock.closed.map((trade) => ({ ...trade, period: key })),
    ),
  )
    .sort((a, b) => b.exitDay.localeCompare(a.exitDay))
    .slice(0, 12);
  return (
    <section className="panel overflow-hidden">
      <PanelTitle title="最近了结的交易（两段合并，按卖出日）" />
      <div className="overflow-auto scroll-thin">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-[11px] text-mute">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-normal">区间</th>
              <th className="px-3 py-2 font-normal">股票</th>
              <th className="px-3 py-2 font-normal">买入 / 卖出</th>
              <th className="px-3 py-2 font-normal text-right">成交价</th>
              <th className="px-3 py-2 font-normal text-right">收益率</th>
              <th className="px-3 py-2 font-normal">离场</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.period}-${row.code}-${row.signalDay}`} className="border-b border-line/70">
                <td className="px-3 py-2 text-mute">{row.period}</td>
                <td className="px-3 py-2">
                  {row.name}
                  <div className="text-[11px] text-mute">{row.code}</div>
                </td>
                <td className="px-3 py-2 text-[12px]">
                  {row.entryDay}
                  <div className="text-mute">{row.exitDay}</div>
                </td>
                <td className="num px-3 py-2 text-right">
                  {formatPrice(row.entryPx)}
                  <div className="text-[11px] text-mute">{formatPrice(row.exitPx)}</div>
                </td>
                <td className={`num px-3 py-2 text-right ${toneClass(row.ret)}`}>{ratioPct(row.ret)}</td>
                <td className="px-3 py-2 text-[12px] text-mute">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function BuyPointBacktest() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-3 p-3">
      <AppHeader />
      <section className="panel px-4 py-3">
        <div className="text-sm">这 4 只选股命中票：按哈药 / 有研买点买、放量长上影后跌破五日线卖</div>
        <p className="mt-2 text-xs text-mute">
          标的为合富中国、博云新材、粤传媒、雪人集团。买点与当前选股规则相同；卖点为确认后出现放量长上影、再跌破 5
          日线，次日开盘卖出。T+1、含佣金印花税与 0.1% 滑点。组合初始 20 万元。{report.meta.dataSource}。合富中国日线从
          2022-02-16 起，2010–2015 无样本。仅供看盘学习，不构成投资建议。
        </p>
      </section>
      {PERIODS.map((key) => (
        <PeriodCard key={key} label={key} periodKey={key} />
      ))}
      <LatestTrades />
      <section className="panel px-4 py-3 text-[11px] text-mute">
        <div className="mb-1">规则与限制</div>
        <ul className="list-disc space-y-1 pl-4">
          {report.meta.assumptions.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
