import { loadBacktest, rankedStrategies, PERIODS, type PeriodStats, type StrategyResult } from "@/lib/backtest";
import { formatPct, toneClass } from "@/lib/format";
import AppHeader from "./AppHeader";
import { PanelTitle } from "./ui";

function pct(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "--";
  return formatPct(value * 100, digits);
}

function ratio(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(2);
}

function yuan(value: number) {
  return `${Math.round(value).toLocaleString("zh-CN")} 元`;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number | null;
}) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2 ring-1 ring-line">
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`num mt-1 text-lg ${tone == null ? "text-ink" : toneClass(tone)}`}>{value}</div>
    </div>
  );
}

function PeriodCells({ stats }: { stats: PeriodStats }) {
  return (
    <>
      <td className={`num px-3 py-2 text-right ${toneClass(stats.totalReturn)}`}>{pct(stats.totalReturn)}</td>
      <td className={`num px-3 py-2 text-right ${toneClass(stats.cagr)}`}>{pct(stats.cagr)}</td>
      <td className="num px-3 py-2 text-right text-down">{pct(stats.maxDrawdown)}</td>
      <td className="num px-3 py-2 text-right">{ratio(stats.payoff)}</td>
    </>
  );
}

function WinnerCard({
  title,
  name,
  hint,
}: {
  title: string;
  name: string;
  hint: string;
}) {
  return (
    <div className="panel p-4">
      <div className="text-[11px] tracking-[0.16em] text-mute uppercase">{title}</div>
      <div className="mt-2 text-base text-gold">{name}</div>
      <p className="mt-2 text-sm leading-6 text-mute">{hint}</p>
    </div>
  );
}

export default function BacktestReport() {
  const report = loadBacktest();
  const ranked = rankedStrategies(report);
  const winner = ranked.find((row) => row.id === report.winner.id) ?? ranked[0];
  const byId = Object.fromEntries(ranked.map((row) => [row.id, row])) as Record<string, StrategyResult>;
  const payoff = byId[report.winner.byMetric.payoff.id];
  const cagr = byId[report.winner.byMetric.cagr.id];
  const drawdown = byId[report.winner.byMetric.drawdown.id];
  const active = byId[report.winner.bestActive.id];

  return (
    <div className="mx-auto flex min-h-screen max-w-[1280px] flex-col gap-4 p-4 md:p-6">
      <AppHeader />
      <section className="panel overflow-hidden">
        <PanelTitle
          title="区间回测"
          extra={<span className="text-[11px] text-mute">起始 20 万 · 红涨绿跌 · 不构成投资建议</span>}
        />
        <div className="space-y-4 p-4">
          <p className="max-w-4xl text-sm leading-7 text-mute">
            在 2010–2015 与 2020–2026 两段，用同一套日线 T+1 规则对比了 {ranked.length}{" "}
            种策略。三项指标不会选出同一名：盈亏比看平均盈利/平均亏损，收益率看区间涨跌，回撤看权益从高点掉下来的最大幅度（越小越好）。综合名次取两段里较差的那个卡玛比率（年化收益/最大回撤）。
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <WinnerCard
              title="综合最优"
              name={winner.name}
              hint={`两段都是正收益的只有这一条。20万期末分别 ${yuan(winner.periods["2010-2015"].endEquity)} / ${yuan(winner.periods["2020-2026"].endEquity)}。`}
            />
            <WinnerCard
              title="盈亏比最高"
              name={payoff.name}
              hint={`两段盈亏比约 ${ratio(payoff.score.meanPayoff)}，但胜率偏低、交易过密，扣费后两段都亏钱。`}
            />
            <WinnerCard
              title="两段都赚 · 收益率"
              name={cagr.name}
              hint={`2010–2015 ${pct(cagr.periods["2010-2015"].totalReturn)}，2020–2026 ${pct(cagr.periods["2020-2026"].totalReturn)}。测试集里唯一两段都为正。`}
            />
            <WinnerCard
              title="回撤最小"
              name={drawdown.name}
              hint={`两段平均最大回撤 ${pct(drawdown.score.meanDrawdown)}，优于沪深300的 ${pct(winner.score.meanDrawdown)}，但 2010–2015 仍小亏。`}
            />
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <PanelTitle title={winner.name} extra={<span className="text-[11px] text-gold">综合第一</span>} />
        <div className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-4">
          {PERIODS.map((period) => {
            const stats = winner.periods[period];
            return (
              <div key={period} className="col-span-1 grid grid-cols-2 gap-2 md:col-span-2 lg:col-span-2">
                <div className="col-span-2 text-xs text-mute">{period}</div>
                <Stat label="区间收益" value={pct(stats.totalReturn)} tone={stats.totalReturn} />
                <Stat label="年化" value={pct(stats.cagr)} tone={stats.cagr} />
                <Stat label="最大回撤" value={pct(stats.maxDrawdown)} tone={stats.maxDrawdown} />
                <Stat label="月度盈亏比" value={ratio(stats.payoff)} />
              </div>
            );
          })}
        </div>
        <div className="border-t border-line px-4 py-3 text-sm leading-7 text-mute">
          <p>{winner.summary}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {winner.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p className="mt-3">
            主动策略里较好的是「{active.name}」：2010–2015 赚 {pct(active.periods["2010-2015"].totalReturn)}
            ，2020–2026 亏 {pct(active.periods["2020-2026"].totalReturn)}，回撤小于一直拿着指数。短线选股（含本站现行规则）两段都大幅亏损，交易次数上千，费用把盈亏比吃掉了。
          </p>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <PanelTitle title="全部对比" extra={<span className="text-[11px] text-mute">按两段较差卡玛比率排序</span>} />
        <div className="overflow-auto scroll-thin">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="text-[11px] text-mute">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-normal">策略</th>
                <th className="px-3 py-2 font-normal" colSpan={4}>
                  2010–2015
                </th>
                <th className="px-3 py-2 font-normal" colSpan={4}>
                  2020–2026
                </th>
              </tr>
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-normal" />
                {PERIODS.flatMap((period) => [
                  <th key={`${period}-ret`} className="px-3 py-2 font-normal text-right">
                    收益
                  </th>,
                  <th key={`${period}-cagr`} className="px-3 py-2 font-normal text-right">
                    年化
                  </th>,
                  <th key={`${period}-dd`} className="px-3 py-2 font-normal text-right">
                    回撤
                  </th>,
                  <th key={`${period}-pay`} className="px-3 py-2 font-normal text-right">
                    盈亏比
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => {
                const isWin = row.id === winner.id;
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-line/70 ${isWin ? "bg-gold/10" : "hover:bg-panel-2/80"}`}
                  >
                    <td className="px-3 py-2">
                      <div className={isWin ? "text-gold" : ""}>
                        {row.name}
                        {isWin ? " · 综合" : ""}
                      </div>
                      <div className="text-[11px] text-mute">
                        {row.family} · {row.periods["2010-2015"].trades + row.periods["2020-2026"].trades} 笔
                      </div>
                    </td>
                    <PeriodCells stats={row.periods["2010-2015"]} />
                    <PeriodCells stats={row.periods["2020-2026"]} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <PanelTitle title="规则与限制" />
        <ul className="list-disc space-y-1 px-4 py-3 pl-8 text-sm leading-7 text-mute">
          {report.meta.assumptions.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>行情：{report.meta.dataSource}。样本 {report.meta.universeSize} 只大盘股 + {report.meta.index.name}。</li>
          <li>测试集里没有任何策略能两段都做到月收益 30%。沪深300最好的单月约 {pct(winner.periods["2010-2015"].bestMonth)} / {pct(winner.periods["2020-2026"].bestMonth)}。</li>
          <li>
            重新计算：<span className="num text-ink">python3 scripts/backtest.py</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
