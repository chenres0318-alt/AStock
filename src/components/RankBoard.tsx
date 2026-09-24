"use client";

import { displaySymbol } from "@/lib/codes";
import { formatAmount, formatPct, formatPrice, toneClass } from "@/lib/format";
import type { RankItem } from "@/lib/types";
import { EmptyHint, PanelTitle } from "./ui";

export type RankTab = "up" | "down" | "amount" | "limitUp" | "limitDown";

const TABS: Array<{ id: RankTab; label: string }> = [
  { id: "up", label: "涨幅" },
  { id: "down", label: "跌幅" },
  { id: "amount", label: "成交额" },
  { id: "limitUp", label: "涨停" },
  { id: "limitDown", label: "跌停" },
];

export default function RankBoard({
  tab,
  onTab,
  items,
  onPick,
}: {
  tab: RankTab;
  onTab: (tab: RankTab) => void;
  items: RankItem[];
  onPick: (code: string, name: string) => void;
}) {
  return (
    <section className="panel flex min-h-[200px] flex-1 flex-col overflow-hidden xl:min-h-0">
      <PanelTitle
        title="市场热度"
        extra={
          <div className="flex gap-1">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onTab(item.id)}
                className={`rounded px-2 py-0.5 text-[11px] ${
                  tab === item.id ? "bg-gold text-bg" : "text-mute hover:text-ink"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr] px-3 py-1.5 text-[10px] text-mute">
        <span>名称</span>
        <span className="text-right">最新</span>
        <span className="text-right">涨跌幅</span>
        <span className="text-right">成交额</span>
      </div>
      <div className="flex-1 overflow-auto scroll-thin">
        {items.length === 0 ? <EmptyHint text="暂无数据" /> : null}
        {items.map((item) => (
          <button
            key={item.code}
            type="button"
            className="grid w-full grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr] items-center border-t border-line/60 px-3 py-1.5 text-left hover:bg-panel-2"
            onClick={() => onPick(item.code, item.name)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm">{item.name}</span>
              <span className="text-[10px] text-mute">{displaySymbol(item.code)}</span>
            </span>
            <span className={`num text-right text-sm ${toneClass(item.pct)}`}>{formatPrice(item.price)}</span>
            <span className={`num text-right text-sm ${toneClass(item.pct)}`}>{formatPct(item.pct)}</span>
            <span className="num text-right text-xs text-mute">{formatAmount(item.amount)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
