"use client";

import { displaySymbol } from "@/lib/codes";
import { formatPct, formatPrice, toneBg, toneClass } from "@/lib/format";
import type { Quote } from "@/lib/types";

export default function IndexStrip({
  indices,
  selected,
  onSelect,
}: {
  indices: Quote[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex gap-2 overflow-x-auto scroll-thin px-2 py-2">
        {indices.map((item) => {
          const active = item.code === selected;
          return (
            <button
              key={item.code}
              type="button"
              onClick={() => onSelect(item.code)}
              className={`min-w-[168px] rounded-lg px-3 py-2 text-left transition ${
                active ? "bg-panel-2 ring-1 ring-gold/40" : "hover:bg-panel-2"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-mute">{item.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] num ${toneBg(item.pct)} ${toneClass(item.pct)}`}>
                  {formatPct(item.pct)}
                </span>
              </div>
              <div className={`mt-1 num text-lg leading-none ${toneClass(item.pct)}`}>
                {formatPrice(item.price)}
              </div>
              <div className="mt-1 text-[10px] text-mute">{displaySymbol(item.code)}</div>
            </button>
          );
        })}
        {indices.length === 0 ? (
          <div className="px-3 py-3 text-sm text-mute">指数加载中…</div>
        ) : null}
      </div>
    </div>
  );
}
