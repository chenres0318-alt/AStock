import { formatPct, formatPrice, toneClass } from "@/lib/format";

export function Tone({
  value,
  children,
  className = "",
}: {
  value: number | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`${toneClass(value)} ${className}`}>{children}</span>;
}

export function PriceCell({
  price,
  pct,
  size = "md",
}: {
  price: number | null | undefined;
  pct?: number | null;
  size?: "sm" | "md" | "xl";
}) {
  const sizeClass =
    size === "xl" ? "text-3xl font-semibold" : size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={`num ${sizeClass} ${toneClass(pct ?? price)}`}>
      {formatPrice(price)}
      {pct != null && size !== "xl" ? (
        <span className="ml-1 text-[11px]">{formatPct(pct)}</span>
      ) : null}
    </span>
  );
}

export function PanelTitle({
  title,
  extra,
}: {
  title: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-line">
      <h2 className="text-xs tracking-[0.16em] text-mute uppercase">{title}</h2>
      {extra}
    </div>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return <div className="px-3 py-6 text-center text-sm text-mute">{text}</div>;
}
