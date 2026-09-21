"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { displaySymbol, marketLabel } from "@/lib/codes";
import { formatPct, formatPrice, toneClass } from "@/lib/format";
import type { Quote, SearchItem, WatchItem } from "@/lib/types";
import { EmptyHint, PanelTitle } from "./ui";

export default function WatchPanel({
  items,
  quotes,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: {
  items: WatchItem[];
  quotes: Map<string, Quote>;
  selected: string;
  onSelect: (code: string) => void;
  onAdd: (item: WatchItem) => void;
  onRemove: (code: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const q = keyword.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { items?: SearchItem[]; error?: string };
        setHits(data.items ?? []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [keyword]);

  const rows = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        quote: quotes.get(item.code),
      })),
    [items, quotes],
  );

  return (
    <section className="panel flex min-h-[320px] flex-col overflow-hidden">
      <PanelTitle title="自选股" extra={<span className="text-[10px] text-mute">按 / 搜索</span>} />
      <div className="relative border-b border-line px-3 py-2" ref={boxRef}>
        <input
          ref={inputRef}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          placeholder="代码 / 名称 / 拼音"
          className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-mute focus:border-gold/60"
        />
        {open && (keyword.trim() || searching) ? (
          <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-panel-2 shadow-xl scroll-thin">
            {searching ? <div className="px-3 py-2 text-xs text-mute">搜索中…</div> : null}
            {!searching && hits.length === 0 ? <div className="px-3 py-2 text-xs text-mute">没有匹配结果</div> : null}
            {hits.map((hit) => (
              <button
                key={hit.code}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-panel"
                onClick={() => {
                  onAdd({ code: hit.code, name: hit.name });
                  setKeyword("");
                  setOpen(false);
                  setHits([]);
                }}
              >
                <span>
                  {hit.name}
                  <span className="ml-2 text-xs text-mute">{displaySymbol(hit.code)}</span>
                </span>
                <span className="text-[10px] text-gold">{hit.typeName}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto scroll-thin">
        {rows.length === 0 ? <EmptyHint text="搜索添加自选股" /> : null}
        {rows.map((row) => {
          const active = row.code === selected;
          const pct = row.quote?.pct ?? null;
          return (
            <div
              key={row.code}
              className={`flex items-center gap-2 border-b border-line/70 px-3 py-2 ${
                active ? "bg-panel-2" : "hover:bg-panel-2/60"
              }`}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(row.code)}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{row.name}</span>
                  <span className="rounded bg-bg px-1 text-[10px] text-mute">{marketLabel(row.code)}</span>
                </div>
                <div className="text-[11px] text-mute">{displaySymbol(row.code)}</div>
              </button>
              <div className="text-right">
                <div className={`num text-sm ${toneClass(pct)}`}>{formatPrice(row.quote?.price)}</div>
                <div className={`num text-[11px] ${toneClass(pct)}`}>{formatPct(pct)}</div>
              </div>
              <button
                type="button"
                className="text-mute hover:text-up"
                title="删除"
                onClick={() => onRemove(row.code)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
