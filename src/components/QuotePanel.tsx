"use client";

import { displaySymbol, marketLabel } from "@/lib/codes";
import {
  formatAmount,
  formatHands,
  formatMv,
  formatPct,
  formatPrice,
  formatSigned,
  toneClass,
} from "@/lib/format";
import { isIndexCode } from "@/lib/codes";
import type { Quote } from "@/lib/types";

function Stat({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return (
    <div className="rounded-md bg-bg/70 px-2.5 py-2">
      <div className="text-[10px] text-mute">{label}</div>
      <div className={`num mt-1 text-sm ${tone == null ? "" : toneClass(tone)}`}>{value}</div>
    </div>
  );
}

export default function QuotePanel({ quote }: { quote: Quote | undefined }) {
  if (!quote) {
    return <div className="panel px-4 py-6 text-sm text-mute">选择一只股票查看行情</div>;
  }

  const maxVol = Math.max(
    1,
    ...quote.bids.map((item) => item.volume ?? 0),
    ...quote.asks.map((item) => item.volume ?? 0),
  );

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-medium">{quote.name}</h1>
            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-gold">
              {marketLabel(quote.code)}
            </span>
            {quote.halted ? <span className="rounded bg-flat/20 px-1.5 py-0.5 text-[10px] text-mute">停牌</span> : null}
          </div>
          <div className="mt-1 text-xs text-mute">{displaySymbol(quote.code)}</div>
        </div>
        <div className="text-right">
          <div className={`num text-4xl leading-none ${toneClass(quote.pct)}`}>{formatPrice(quote.price)}</div>
          <div className={`num mt-1 text-sm ${toneClass(quote.pct)}`}>
            {formatSigned(quote.change)}　{formatPct(quote.pct)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-line px-3 py-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="今开" value={formatPrice(quote.open)} tone={quote.preClose != null && quote.open != null ? quote.open - quote.preClose : 0} />
        <Stat label="最高" value={formatPrice(quote.high)} tone={quote.preClose != null && quote.high != null ? quote.high - quote.preClose : 0} />
        <Stat label="最低" value={formatPrice(quote.low)} tone={quote.preClose != null && quote.low != null ? quote.low - quote.preClose : 0} />
        <Stat label="昨收" value={formatPrice(quote.preClose)} />
        <Stat label="成交量" value={formatHands(quote.volume)} />
        <Stat label="成交额" value={formatAmount(quote.amount)} />
        <Stat label="换手" value={quote.turnover == null ? "--" : `${quote.turnover.toFixed(2)}%`} />
        <Stat label="振幅" value={quote.amplitude == null ? "--" : `${quote.amplitude.toFixed(2)}%`} />
        <Stat label="市盈率" value={quote.pe == null ? "--" : quote.pe.toFixed(2)} />
        <Stat label="市净率" value={quote.pb == null ? "--" : quote.pb.toFixed(2)} />
        <Stat label="总市值" value={formatMv(quote.totalMv)} />
        <Stat label="流通值" value={formatMv(quote.floatMv)} />
      </div>

      {isIndexCode(quote.code) ? null : (
      <div className="grid gap-3 border-t border-line px-3 py-3 lg:grid-cols-[1fr_220px]">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="mb-2 text-mute">卖盘</div>
            {[...quote.asks].reverse().map((level, index) => (
              <div key={`a-${index}`} className="flex items-center gap-2 py-0.5">
                <span className="w-8 text-mute">卖{5 - index}</span>
                <span className={`num w-16 ${toneClass(1)}`}>{formatPrice(level.price)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-bg">
                  <div
                    className="h-full bg-up/40"
                    style={{ width: `${((level.volume ?? 0) / maxVol) * 100}%` }}
                  />
                </div>
                <span className="num w-12 text-right text-mute">{level.volume ?? "--"}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 text-mute">买盘</div>
            {quote.bids.map((level, index) => (
              <div key={`b-${index}`} className="flex items-center gap-2 py-0.5">
                <span className="w-8 text-mute">买{index + 1}</span>
                <span className={`num w-16 ${toneClass(-1)}`}>{formatPrice(level.price)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-bg">
                  <div
                    className="h-full bg-down/40"
                    style={{ width: `${((level.volume ?? 0) / maxVol) * 100}%` }}
                  />
                </div>
                <span className="num w-12 text-right text-mute">{level.volume ?? "--"}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md bg-bg px-3 py-3 text-xs">
          <div className="text-mute">内外盘</div>
          <div className="mt-2 flex h-2 overflow-hidden rounded">
            <div
              className="bg-up"
              style={{
                width: `${((quote.outer ?? 0) / Math.max(1, (quote.outer ?? 0) + (quote.inner ?? 0))) * 100}%`,
              }}
            />
            <div className="flex-1 bg-down" />
          </div>
          <div className="mt-2 flex justify-between num">
            <span className="text-up">外 {formatHands(quote.outer)}</span>
            <span className="text-down">内 {formatHands(quote.inner)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="text-mute">涨停</div>
              <div className="num text-up">{formatPrice(quote.limitUp)}</div>
            </div>
            <div>
              <div className="text-mute">跌停</div>
              <div className="num text-down">{formatPrice(quote.limitDown)}</div>
            </div>
          </div>
        </div>
      </div>
      )}
    </section>
  );
}
