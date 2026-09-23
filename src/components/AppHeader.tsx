"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "看盘" },
  { href: "/screener", label: "选股" },
  { href: "/backtest", label: "回测" },
];

export default function AppHeader({
  trailing,
}: {
  trailing?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-end gap-0.5 rounded-lg bg-panel px-1.5 py-1 ring-1 ring-line">
          <span className="h-5 w-1.5 rounded-sm bg-up" />
          <span className="h-3 w-1.5 rounded-sm bg-gold" />
          <span className="h-4 w-1.5 rounded-sm bg-down" />
        </div>
        <div>
          <div className="text-lg font-medium leading-tight">
            AStock <span className="text-gold">看盘</span>
          </div>
          <div className="text-[11px] text-mute">沪深京实时行情 · 红涨绿跌</div>
        </div>
        <nav className="ml-2 flex gap-1 rounded-full bg-panel p-1 ring-1 ring-line">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-3 py-1 text-xs ${
                  active ? "bg-gold text-bg" : "text-mute hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">{trailing}</div>
    </header>
  );
}
