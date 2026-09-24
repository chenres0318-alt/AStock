"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isListedStockCode } from "@/lib/codes";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import { loadWatchlist, saveWatchlist } from "@/lib/storage";
import type { ScreenerHit } from "@/lib/types";
import AppHeader from "./AppHeader";
import { EmptyHint, PanelTitle } from "./ui";

type StockResponse = {
  scanned: number;
  universe?: number;
  items: ScreenerHit[];
  elapsedMs?: number;
  source?: string;
  error?: string;
};

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(120_000) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function HitTable({
  items,
  onOpen,
}: {
  items: ScreenerHit[];
  onOpen: (item: ScreenerHit) => void;
}) {
  if (!items.length) return <EmptyHint text="没有符合买点条件的结果" />;
  return (
    <div className="overflow-auto scroll-thin">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-[11px] text-mute">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-normal">股票</th>
            <th className="px-3 py-2 font-normal text-right">现价 / MA5</th>
            <th className="px-3 py-2 font-normal text-right">涨跌幅</th>
            <th className="px-3 py-2 font-normal text-right">回撤</th>
            <th className="px-3 py-2 font-normal text-right">换手</th>
            <th className="px-3 py-2 font-normal text-right">MACD柱</th>
            <th className="px-3 py-2 font-normal">买点条件</th>
            <th className="px-3 py-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.code} className="border-b border-line/70 hover:bg-panel-2/80">
              <td className="px-3 py-2">
                <button type="button" className="text-left" onClick={() => onOpen(item)}>
                  <div>{item.name}</div>
                  <div className="text-[11px] text-mute">{item.code}</div>
                </button>
              </td>
              <td className="px-3 py-2 text-right">
                <div className={`num ${toneClass(item.pct)}`}>{formatPrice(item.price)}</div>
                <div className="num text-[11px] text-mute">{formatPrice(item.ma5)}</div>
              </td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.pct)}`}>{formatPct(item.pct)}</td>
              <td className="num px-3 py-2 text-right text-mute">
                {item.pullbackPct == null ? "--" : `${item.pullbackPct.toFixed(1)}%`}
              </td>
              <td className="num px-3 py-2 text-right">
                {item.turnover == null ? "--" : `${item.turnover.toFixed(2)}%`}
              </td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.hist)}`}>{item.hist.toFixed(3)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {item.reasons.map((reason) => (
                    <span key={reason} className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-gold">
                      {reason}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  className="rounded-full bg-gold px-2 py-1 text-[11px] text-bg"
                  onClick={() => onOpen(item)}
                >
                  看盘
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Screener() {
  const router = useRouter();
  const [hits, setHits] = useState<ScreenerHit[]>([]);
  const [meta, setMeta] = useState<{
    scanned: number;
    universe?: number;
    elapsedMs?: number;
    source?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await readJson<StockResponse>("/api/screener/stocks");
      setHits(data.items);
      setMeta({
        scanned: data.scanned,
        universe: data.universe,
        elapsedMs: data.elapsedMs,
        source: data.source,
      });
      if (data.error) setError(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "选股失败");
    } finally {
      setLoading(false);
    }
  };

  const openStock = (item: ScreenerHit) => {
    if (!isListedStockCode(item.code)) return;
    const saved = loadWatchlist();
    const next = saved.items.some((row) => row.code === item.code)
      ? saved.items
      : [{ code: item.code, name: item.name }, ...saved.items];
    saveWatchlist(next, item.code);
    router.push(`/?code=${item.code}`);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-3 p-3">
      <AppHeader />

      <section className="panel px-4 py-3">
        <div className="text-sm">买点选股：急跌双底后的涨停 / 大阳确认</div>
        <div className="mt-2 grid gap-2 text-xs text-mute md:grid-cols-2">
          <p>
            对照哈药股份、有研新材一类买点：急跌后二次探底不破前低（双底或锤头），底部分量小于恐慌日，MACD
            绿柱缩至 0 轴附近后翻头。
          </p>
          <p>
            确认不是「刚站上五日线」：要用涨停或大阳打开均线（五日线上穿或站上十日线）。启动日换手往往不是阶段天量。扫描成交额靠前的沪深 A
            股，不含 ST / 北交所，也不再限制近 3 日涨幅、不再先筛板块。
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div>
      ) : null}

      <section className="panel overflow-hidden">
        <PanelTitle
          title="按买点扫描个股"
          extra={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {meta ? (
                <span className="text-[10px] text-mute">
                  池 {meta.universe ?? meta.scanned} · 扫描 {meta.scanned} · 命中 {hits.length}
                  {meta.source === "sina" ? " · 新浪成交额" : meta.source === "eastmoney" ? " · 东财成交额" : ""}
                  {meta.elapsedMs ? ` · ${Math.round(meta.elapsedMs / 1000)}s` : ""}
                </span>
              ) : null}
              <button
                type="button"
                onClick={runScan}
                disabled={loading}
                className="rounded-full bg-gold px-3 py-1 text-xs text-bg disabled:opacity-60"
              >
                {loading ? "扫描中…" : "开始选股"}
              </button>
            </div>
          }
        />
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-mute">
            正在拉取成交额靠前的沪深 A 股日线并匹配买点，大约需要一分钟。不会先筛板块。
          </div>
        ) : (
          <HitTable items={hits} onOpen={openStock} />
        )}
      </section>

      <p className="pb-1 text-center text-[11px] text-mute">
        规则按日线复权行情计算，仅供看盘学习，不构成投资建议。
      </p>
    </div>
  );
}
