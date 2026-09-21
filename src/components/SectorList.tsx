"use client";

import { displaySymbol, isListedStockCode } from "@/lib/codes";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import type { SectorItem } from "@/lib/types";
import { EmptyHint, PanelTitle } from "./ui";

export default function SectorList({
  items,
  onPick,
}: {
  items: SectorItem[];
  onPick: (code: string, name: string) => void;
}) {
  return (
    <section className="panel flex min-h-[220px] flex-1 flex-col overflow-hidden">
      <PanelTitle
        title="行业板块"
        extra={
          <span className="text-[10px] text-mute">
            {items[0]?.source === "etf" ? "行业ETF" : items[0]?.source === "sina" ? "证监会行业" : "涨幅排序"}
          </span>
        }
      />
      <div className="flex-1 overflow-auto scroll-thin">
        {items.length === 0 ? <EmptyHint text="板块暂不可用" /> : null}
        {items.map((item) => (
          <button
            key={`${item.code}-${item.name}`}
            type="button"
            className="flex w-full items-center gap-2 border-b border-line/70 px-3 py-2 text-left hover:bg-panel-2"
            onClick={() => {
              if (item.leaderCode) onPick(item.leaderCode, item.leader || item.name);
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{item.name}</div>
              <div className="truncate text-[11px] text-mute">
                {item.leader
                  ? `领涨 ${item.leader}`
                  : isListedStockCode(item.code)
                    ? displaySymbol(item.code)
                    : item.code}
              </div>
            </div>
            <div className="text-right">
              <div className={`num text-sm ${toneClass(item.pct)}`}>{formatPct(item.pct)}</div>
              {item.upCount != null ? (
                <div className="text-[10px] text-mute">
                  {item.upCount}涨 {item.downCount ?? 0}跌
                </div>
              ) : (
                <div className={`num text-[11px] ${toneClass(item.pct)}`}>{formatPrice(item.price)}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
