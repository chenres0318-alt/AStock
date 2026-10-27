"use client";

import { useMemo } from "react";
import Link from "next/link";
import { displaySymbol, isListedStockCode, isTonghuashunBoard, priceDigits } from "@/lib/codes";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import type { SectorItem } from "@/lib/types";
import { EmptyHint, PanelTitle } from "./ui";

export default function SectorList({
  items,
  onPick,
  liveCodes = [],
}: {
  items: SectorItem[];
  onPick: (code: string, name: string) => void;
  liveCodes?: string[];
}) {
  const ordered = useMemo(() => {
    if (!liveCodes.length) return items;
    const live = new Set(liveCodes);
    return [...items.filter((item) => live.has(item.code)), ...items.filter((item) => !live.has(item.code))];
  }, [items, liveCodes]);
  const live = useMemo(() => new Set(liveCodes), [liveCodes]);
  return (
    <section className="panel flex min-h-[220px] flex-1 flex-col overflow-hidden xl:min-h-0">
      <PanelTitle
        title="行业板块"
        extra={
          <span className="flex items-center gap-2 text-[10px] text-mute">
            <span>
              {items[0]?.source === "ths"
                ? "同花顺行业 · 涨幅前20"
                : items[0]?.source === "etf"
                  ? "行业ETF"
                  : items[0]?.source === "sina"
                    ? "证监会行业"
                    : "涨幅排序"}
            </span>
            {items[0]?.source === "ths" ? (
              <Link href="/sector" className="text-gold">
                全部
              </Link>
            ) : null}
          </span>
        }
      />
      <div className="flex-1 overflow-auto scroll-thin">
        {items.length === 0 ? <EmptyHint text="板块暂不可用" /> : null}
        {ordered.map((item) => (
          <div
            key={`${item.code}-${item.name}`}
            className="flex w-full items-center gap-2 border-b border-line/70 px-3 py-2 hover:bg-panel-2"
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (item.leaderCode) onPick(item.leaderCode, item.leader || item.name);
              }}
            >
              <div className={`truncate text-sm ${live.has(item.code) ? "text-up" : ""}`}>{item.name}</div>
              <div className="truncate text-[11px] text-mute">
                {item.leader
                  ? `领涨 ${item.leader}`
                  : isListedStockCode(item.code)
                    ? displaySymbol(item.code)
                    : item.code}
              </div>
            </button>
            {isTonghuashunBoard(item.code) || item.code.startsWith("BK") ? (
              <Link href={`/sector?code=${item.code}`} className="shrink-0 text-[10px] text-gold">
                趋势
              </Link>
            ) : null}
            <div className="text-right">
              <div className={`num text-sm ${toneClass(item.pct)}`}>{formatPct(item.pct)}</div>
              {item.upCount != null ? (
                <div className="text-[10px] text-mute">
                  {item.upCount}涨 {item.downCount ?? 0}跌
                </div>
              ) : (
                <div className={`num text-[11px] ${toneClass(item.pct)}`}>{formatPrice(item.price, priceDigits(item.code, item.name))}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
