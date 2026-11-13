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
  discovering?: boolean;
  industryLive?: number;
  conceptLive?: number;
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
  const timeout = AbortSignal.timeout(25_000);
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

function isRetryableScanError(error: unknown, userSignal?: AbortSignal): boolean {
  if (userSignal?.aborted) return false;
  if (isAbortError(error)) return true;
  if (error instanceof TypeError) return true;
  return error instanceof Error && /failed to fetch/i.test(error.message);
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    return await fetchScreen<T>(url, signal);
  } catch (error) {
    if (!isRetryableScanError(error, signal)) throw error;
    return await fetchScreen<T>(url, signal);
  }
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
  discovering,
  onOpen,
  holdingCodes,
  onToggleHold,
}: {
  items: ScreenerHit[];
  scanning: boolean;
  discovering?: boolean;
  onOpen: (item: ScreenerHit) => void;
  holdingCodes: Set<string>;
  onToggleHold: (item: ScreenerHit) => void;
}) {
  if (!items.length) {
    const scanningText = discovering
      ? "正在拉取行业成分股，扫到符合均线的股票会马上出现"
      : "正在扫描，按均线条件持续天数从短到长排";
    const idleText = "没有符合条件的结果";
    return <EmptyHint text={scanning ? scanningText : idleText} />;
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
                {(() => {
                  const boards =
                    item.boards?.length
                      ? item.boards
                      : item.sector
                        ? [{ code: item.sectorCode ?? "", name: item.sector }]
                        : [];
                  if (!boards.length) return <span className="text-mute">--</span>;
                  return (
                    <div className="flex max-w-[320px] flex-wrap gap-x-2 gap-y-0.5">
                      {boards.map((board) =>
                        board.code ? (
                          <Link
                            key={board.code}
                            href={`/sector?code=${board.code}`}
                            className="text-gold hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {board.name}
                          </Link>
                        ) : (
                          <span key={board.name} className="text-mute">
                            {board.name}
                          </span>
                        ),
                      )}
                    </div>
                  );
                })()}
              </td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.pct)}`}>
                {formatPrice(item.price, priceDigits(item.code, item.name))}
              </td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.pct)}`}>{formatPct(item.pct)}</td>
              <td className="num px-3 py-2 text-right">{item.standDays}日</td>
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
    discovering?: boolean;
    industryLive?: number;
    conceptLive?: number;
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
    let misses = 0;
    try {
      for (;;) {
        try {
          const data = await readJson<StockResponse>("/api/screener/stocks", ac.signal);
          if (ac.signal.aborted) return;
          misses = 0;
          setHits(data.items);
          setMeta({
            scanned: data.scanned,
            universe: data.universe,
            liveBoards: data.liveBoards,
            elapsedMs: Date.now() - startedAt,
            source: data.source,
            discovering: data.discovering,
            industryLive: data.industryLive,
            conceptLive: data.conceptLive,
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
          setError(null);
        } catch (err) {
          if (ac.signal.aborted) return;
          misses += 1;
          if (misses >= 4) {
            setError(scanErrorMessage(err));
            break;
          }
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
          选股：不看板块概念是否红框，只筛选股价站上MA4，并且MA4&gt;MA7&gt;MA10，并且MA4、MA7、MA10大于上一日。并且周K线呈MA4&gt;MA7&gt;MA10排列。
        </div>
        <div className="mt-2 max-w-4xl text-xs leading-5 text-mute">
          持续时间是股价站上MA4、且MA4、MA7、MA10都比上一日高的连续天数，越短越靠前。当天还须日线 MA4&gt;MA7&gt;MA10。周 K 须呈 MA4&gt;MA7&gt;MA10 排列。扫行业和概念里的主板成分股。所属板块同时列出行业和概念，可点进板块页。不含科创板、创业板、北交所、ST。同一只股票只出现一次。
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
                  扫描 {meta.scanned}{meta?.universe ? `/${meta.universe}` : ""} · 命中 {hits.length}
                  {meta.source === "ths-board" || meta.source === "ths-industry" ? " · 同花顺行业+概念" : ""}
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
            {meta?.discovering
              ? "正在拉取行业成分股，边扫边显示。"
              : "边扫边显示，按均线条件持续天数从短到长排。"}{" "}
            已扫 {meta?.scanned ?? 0}
            {meta?.universe ? `/${meta.universe}` : ""} · 命中 {hits.length}
          </div>
        ) : null}
        <HitTable
          items={hits}
          scanning={loading}
          discovering={meta?.discovering}
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
