"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isListedStockCode } from "@/lib/codes";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import { loadWatchlist, saveWatchlist } from "@/lib/storage";
import type { ScreenerHit } from "@/lib/types";
import AppHeader from "./AppHeader";
import { EmptyHint, PanelTitle } from "./ui";

type SectorResponse = {
  scanned: number;
  items: ScreenerHit[];
  elapsedMs?: number;
  source?: string;
  error?: string;
};

type StockResponse = {
  scanned: number;
  items: ScreenerHit[];
  elapsedMs?: number;
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
  kind,
  selected,
  onToggle,
  onOpen,
}: {
  items: ScreenerHit[];
  kind: "board" | "stock";
  selected: Set<string>;
  onToggle: (code: string) => void;
  onOpen: (item: ScreenerHit) => void;
}) {
  if (!items.length) return <EmptyHint text="没有符合条件的结果" />;
  return (
    <div className="overflow-auto scroll-thin">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-[11px] text-mute">
          <tr className="border-b border-line">
            {kind === "board" ? <th className="px-3 py-2 font-normal">选</th> : null}
            <th className="px-3 py-2 font-normal">{kind === "board" ? "板块" : "股票"}</th>
            {kind === "stock" ? <th className="px-3 py-2 font-normal">板块</th> : null}
            <th className="px-3 py-2 font-normal text-right">现价 / MA5</th>
            <th className="px-3 py-2 font-normal text-right">MACD柱</th>
            <th className="px-3 py-2 font-normal text-right">{kind === "stock" ? "3日涨幅" : "涨跌幅"}</th>
            {kind === "stock" ? <th className="px-3 py-2 font-normal text-right">换手</th> : null}
            <th className="px-3 py-2 font-normal">条件</th>
            {kind === "stock" ? <th className="px-3 py-2 font-normal"></th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.boardCode}-${item.code}`} className="border-b border-line/70 hover:bg-panel-2/80">
              {kind === "board" ? (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(item.code)}
                    onChange={() => onToggle(item.code)}
                  />
                </td>
              ) : null}
              <td className="px-3 py-2">
                <button type="button" className="text-left" onClick={() => onOpen(item)}>
                  <div>{item.name}</div>
                  <div className="text-[11px] text-mute">{item.code}</div>
                </button>
              </td>
              {kind === "stock" ? <td className="px-3 py-2 text-mute">{item.boardName}</td> : null}
              <td className="px-3 py-2 text-right">
                <div className={`num ${toneClass(item.pct)}`}>{formatPrice(item.price)}</div>
                <div className="num text-[11px] text-mute">{formatPrice(item.ma5)}</div>
              </td>
              <td className={`num px-3 py-2 text-right ${toneClass(item.hist)}`}>{item.hist.toFixed(3)}</td>
              <td className="px-3 py-2 text-right">
                {kind === "stock" ? (
                  <span className={`num ${toneClass(item.threeDayPct)}`}>{formatPct(item.threeDayPct)}</span>
                ) : (
                  <span className={`num ${toneClass(item.pct)}`}>{formatPct(item.pct)}</span>
                )}
              </td>
              {kind === "stock" ? (
                <td className="num px-3 py-2 text-right">
                  {item.turnover == null ? "--" : `${item.turnover.toFixed(2)}%`}
                </td>
              ) : null}
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {item.reasons.map((reason) => (
                    <span key={reason} className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-gold">
                      {reason}
                    </span>
                  ))}
                </div>
              </td>
              {kind === "stock" ? (
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="rounded-full bg-gold px-2 py-1 text-[11px] text-bg"
                    onClick={() => onOpen(item)}
                  >
                    看盘
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Screener() {
  const router = useRouter();
  const [boardHits, setBoardHits] = useState<ScreenerHit[]>([]);
  const [stockHits, setStockHits] = useState<ScreenerHit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [boardMeta, setBoardMeta] = useState<{ scanned: number; elapsedMs?: number; source?: string } | null>(null);
  const [stockMeta, setStockMeta] = useState<{ scanned: number; elapsedMs?: number } | null>(null);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBoards = useMemo(
    () => boardHits.filter((item) => selected.has(item.code)),
    [boardHits, selected],
  );

  const runBoards = async () => {
    setLoadingBoards(true);
    setError(null);
    setStockHits([]);
    try {
      const data = await readJson<SectorResponse>("/api/screener/sectors");
      setBoardHits(data.items);
      setSelected(new Set(data.items.map((item) => item.code)));
      setBoardMeta({ scanned: data.scanned, elapsedMs: data.elapsedMs, source: data.source });
      if (data.error) setError(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "板块筛选失败");
    } finally {
      setLoadingBoards(false);
    }
  };

  const runStocks = async () => {
    if (!selectedBoards.length) {
      setError("请先筛选并勾选板块");
      return;
    }
    setLoadingStocks(true);
    setError(null);
    try {
      const boards = selectedBoards.map((item) => item.code).join(",");
      const data = await readJson<StockResponse>(`/api/screener/stocks?boards=${encodeURIComponent(boards)}`);
      setStockHits(data.items);
      setStockMeta({ scanned: data.scanned, elapsedMs: data.elapsedMs });
    } catch (err) {
      setError(err instanceof Error ? err.message : "选股失败");
    } finally {
      setLoadingStocks(false);
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
        <div className="text-sm">技术选股：先板块、再成分股</div>
        <div className="mt-2 grid gap-2 text-xs text-mute md:grid-cols-2">
          <p>
            板块条件：收盘站上 5 日均线；5 日均线拐头向上；MACD 处于死叉（DIF 在 DEA 下方）；绿柱连续缩短并靠近 0 轴。
          </p>
          <p>
            股票在入选板块内再筛：同样满足上述形态，且近 3 日涨幅不超过 4%，换手率不低于 2%。不含 ST / 北交所。
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div>
      ) : null}

      <section className="panel overflow-hidden">
        <PanelTitle
          title="1. 筛选板块"
          extra={
            <div className="flex items-center gap-2">
              {boardMeta ? (
                <span className="text-[10px] text-mute">
                  扫描 {boardMeta.scanned} 个板块 · 命中 {boardHits.length} ·{" "}
                  {boardMeta.source === "sina" ? "新浪行业 · " : boardMeta.source === "bk" ? "东财行业 · " : ""}
                  {boardMeta.elapsedMs ? `${Math.round(boardMeta.elapsedMs / 1000)}s` : ""}
                </span>
              ) : null}
              {boardHits.length ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(boardHits.map((item) => item.code)))}
                    className="rounded-full bg-panel px-2 py-1 text-[11px] text-ink ring-1 ring-line"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="rounded-full bg-panel px-2 py-1 text-[11px] text-ink ring-1 ring-line"
                  >
                    清空
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={runBoards}
                disabled={loadingBoards}
                className="rounded-full bg-gold px-3 py-1 text-xs text-bg disabled:opacity-60"
              >
                {loadingBoards ? "板块扫描中…" : "开始筛选板块"}
              </button>
            </div>
          }
        />
        {loadingBoards ? (
          <div className="px-4 py-8 text-center text-sm text-mute">
            正在拉取行业板块日线并计算 MA5 / MACD，大约需要一分钟。东财不可用时会改用新浪证监会行业分类。
          </div>
        ) : (
          <HitTable
            items={boardHits}
            kind="board"
            selected={selected}
            onToggle={(code) => {
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(code)) next.delete(code);
                else next.add(code);
                return next;
              });
            }}
            onOpen={() => undefined}
          />
        )}
      </section>

      <section className="panel overflow-hidden">
        <PanelTitle
          title="2. 在入选板块中选股"
          extra={
            <div className="flex items-center gap-2">
              {stockMeta ? (
                <span className="text-[10px] text-mute">
                  扫描 {stockMeta.scanned} 只 · 命中 {stockHits.length} ·{" "}
                  {stockMeta.elapsedMs ? `${Math.round(stockMeta.elapsedMs / 1000)}s` : ""}
                </span>
              ) : null}
              <button
                type="button"
                onClick={runStocks}
                disabled={loadingStocks || !selectedBoards.length}
                className="rounded-full bg-gold px-3 py-1 text-xs text-bg disabled:opacity-60"
              >
                {loadingStocks ? "选股中…" : `筛选 ${selectedBoards.length} 个板块成分股`}
              </button>
            </div>
          }
        />
        {loadingStocks ? (
          <div className="px-4 py-8 text-center text-sm text-mute">
            正在计算成分股日线指标，勾选板块越多耗时越长。
          </div>
        ) : (
          <HitTable
            items={stockHits}
            kind="stock"
            selected={selected}
            onToggle={() => undefined}
            onOpen={openStock}
          />
        )}
      </section>

      <p className="pb-1 text-center text-[11px] text-mute">
        规则按日线复权行情计算，仅供看盘学习，不构成投资建议。
      </p>
    </div>
  );
}