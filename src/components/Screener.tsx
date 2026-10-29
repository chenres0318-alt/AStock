"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isListedStockCode, priceDigits } from "@/lib/codes";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import { isAbortError } from "@/lib/readJson";
import { loadWatchlist, saveWatchlist } from "@/lib/storage";
import { useHoldings } from "@/lib/useHoldings";
import type { ScreenerHit } from "@/lib/types";
import AppHeader from "./AppHeader";
import { EmptyHint, PanelTitle } from "./ui";

type StockResponse = {
  scanned: number;
  universe?: number;
  liveBoards?: number;
  items: ScreenerHit[];
  elapsedMs?: number;
  source?: string;
  error?: string;
  timedOut?: boolean;
  scanning?: boolean;
};

function scanErrorMessage(error: unknown): string {
  if (isAbortError(error)) return "选股超时，请再点一次开始选股";
  const message = error instanceof Error ? error.message : "";
  if (!message || /failed to fetch/i.test(message) || error instanceof TypeError) {
    return "选股服务中断，请再点一次开始选股";
  }
  return message;
}

function combineSignals(timeout: AbortSignal, extra?: AbortSignal): AbortSignal {
  if (!extra) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([timeout, extra]);
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (timeout.aborted || extra.aborted) {
    ac.abort();
    return ac.signal;
  }
  timeout.addEventListener("abort", abort, { once: true });
  extra.addEventListener("abort", abort, { once: true });
  return ac.signal;
}

async function fetchScreen<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(12_000);
  const res = await fetch(url, { cache: "no-store", signal: combineSignals(timeout, signal) });
  let data: T & { error?: string };
  try {
    data = (await res.json()) as T & { error?: string };
  } catch {
    throw new TypeError("Failed to fetch");
  }
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    return await fetchScreen<T>(url, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof TypeError || (error instanceof Error && /failed to fetch/i.test(error.message))) {
      return await fetchScreen<T>(url, signal);
    }
    throw error;
  }
}

function durationHint(item: ScreenerHit): string {
  const parts: string[] = [];
  if (item.crossDays) parts.push(`上叉${item.crossDays}日`);
  if (item.weekDays) parts.push(`周${item.weekDays}周`);
  if (item.monthDays) parts.push(`月${item.monthDays}月`);
  if (item.dailyDays != null) parts.push(`日${item.dailyDays}日`);
  return parts.join(" · ");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

function HitTable({
  items,
  scanning,
  onOpen,
  holdingCodes,
  onToggleHold,
}: {
  items: ScreenerHit[];
  scanning: boolean;
  onOpen: (item: ScreenerHit) => void;
  holdingCodes: Set<string>;
  onToggleHold: (item: ScreenerHit) => void;
}) {
  if (!items.length) {
    return <EmptyHint text={scanning ? "正在扫描，扫到的股票会马上出现并重新排序" : "没有符合条件的结果"} />;
  }
  return (
    <div className="overflow-auto scroll-thin">
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead className="text-[11px] text-mute">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-normal">股票</th>
            <th className="px-3 py-2 font-normal">所属板块</th>
            <th className="px-3 py-2 font-normal text-right">现价</th>
            <th className="px-3 py-2 font-normal text-right">涨跌幅</th>
            <th className="px-3 py-2 font-normal text-right">持续</th>
            <th className="px-3 py-2 font-normal">条件</th>
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
              <td className="px-3 py-2">
                {item.sectorCode ? (
                  <Link href={`/sector?code=${item.sectorCode}`} className="text-gold hover:underline" onClick={(event) => event.stopPropagation()}>
                    {item.sector}
                  </Link>
                ) : (
                  <span className="text-mute">{item.sector ?? "--"}</span>
                )}
              </td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.pct)}`}>
                {formatPrice(item.price, priceDigits(item.code, item.name))}
              </td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.pct)}`}>{formatPct(item.pct)}</td>
              <td className="px-3 py-2 text-right">
                <div className="num">{item.standDays}日</div>
                <div className="mt-0.5 text-[10px] leading-4 text-mute">{durationHint(item)}</div>
              </td>
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
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    className="rounded-full bg-gold px-2 py-1 text-[11px] text-bg"
                    onClick={() => onOpen(item)}
                  >
                    看盘
                  </button>
                  {holdingCodes.has(item.code) ? (
                    <button
                      type="button"
                      aria-label={`移出持仓 ${item.name}`}
                      title="移出持仓"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-panel text-base leading-none text-mute ring-1 ring-line hover:text-up"
                      onClick={() => onToggleHold(item)}
                    >
                      −
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`加入持仓 ${item.name}`}
                      title="加入持仓"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-base leading-none text-bg"
                      onClick={() => onToggleHold(item)}
                    >
                      +
                    </button>
                  )}
                </div>
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
  const { items: holdings, toggle } = useHoldings();
  const holdingCodes = new Set(holdings.map((item) => item.code));
  const [hits, setHits] = useState<ScreenerHit[]>([]);
  const [meta, setMeta] = useState<{
    scanned: number;
    universe?: number;
    liveBoards?: number;
    elapsedMs?: number;
    source?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollAbort = useRef<AbortController | null>(null);

  useEffect(() => () => pollAbort.current?.abort(), []);

  const runScan = async () => {
    pollAbort.current?.abort();
    const ac = new AbortController();
    pollAbort.current = ac;
    setLoading(true);
    setError(null);
    const startedAt = Date.now();
    try {
      for (;;) {
        const data = await readJson<StockResponse>("/api/screener/stocks", ac.signal);
        if (ac.signal.aborted) return;
        setHits(data.items);
        setMeta({
          scanned: data.scanned,
          universe: data.universe,
          liveBoards: data.liveBoards,
          elapsedMs: Date.now() - startedAt,
          source: data.source,
        });
        if (data.error) {
          setError(data.error);
          break;
        }
        if (!data.scanning) {
          if (data.timedOut) setError("扫描超时，下面是已经扫到的结果，可再点一次继续");
          else setError(null);
          break;
        }
        await sleep(800, ac.signal);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(scanErrorMessage(err));
    } finally {
      if (pollAbort.current === ac) setLoading(false);
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
        <div className="text-sm">
          选股：板块当前红框（不限第几天）、指数站上 MA4 的同花顺行业，再列出收盘站上 MA4 的成分股
        </div>
        <div className="mt-2 max-w-4xl text-xs leading-5 text-mute">
          先找当前红框、且指数收盘站上 4 日线的同花顺行业，不区分红框第几天。再列出里面收盘站上 MA4 的股票。MA4 上叉 MA7、周 K 站上 MA4、月 K 站上 MA4 更好；排序和持续天数按右侧这些条件同时成立的天数，以及各条件自己的持续（短的在前）。扫到就显示。不含科创板、创业板、北交所、ST。同一只股票只出现一次。结果带所属板块，可点进板块页核对红框。
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div>
      ) : null}

      <section className="panel overflow-hidden">
        <PanelTitle
          title="扫描个股"
          extra={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {meta ? (
                <span className="text-[10px] text-mute">
                  红框行业 {meta.liveBoards ?? "--"} · 站上MA4 {meta.universe ?? meta.scanned} · 扫描 {meta.scanned} · 命中 {hits.length}
                  {meta.source === "ths-industry" ? " · 同花顺行业" : ""}
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
          <div className="border-b border-line px-4 py-2 text-xs text-mute">
            边扫边显示，扫到就按上叉 / 周K / 月K / 条件持续重新排序。已扫 {meta?.scanned ?? 0}
            {meta?.universe ? `/${meta.universe}` : ""} · 命中 {hits.length}
          </div>
        ) : null}
        <HitTable
          items={hits}
          scanning={loading}
          onOpen={openStock}
          holdingCodes={holdingCodes}
          onToggleHold={(item) =>
            toggle({
              code: item.code,
              name: item.name,
              sector: item.sector,
              sectorCode: item.sectorCode,
            })
          }
        />
      </section>

      <p className="pb-1 text-center text-[11px] text-mute">
        规则按日线复权行情计算，仅供看盘学习，不构成投资建议。
      </p>
    </div>
  );
}
