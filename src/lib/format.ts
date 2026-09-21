export function toNumber(value: unknown): number | null {
  if (value == null || value === "" || value === "-" || value === "--") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function formatPrice(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--";
  const abs = Math.abs(value);
  const d = abs >= 1000 ? 2 : abs >= 100 ? 2 : digits;
  return value.toFixed(d);
}

export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--";
  const abs = formatPrice(Math.abs(value), digits);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--";
  return `${formatSigned(value, digits)}%`;
}

export function formatAmount(yuan: number | null | undefined): string {
  if (yuan == null || Number.isNaN(yuan)) return "--";
  const abs = Math.abs(yuan);
  const sign = yuan < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatHands(hands: number | null | undefined): string {
  if (hands == null || Number.isNaN(hands)) return "--";
  const abs = Math.abs(hands);
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(2)}亿手`;
  if (abs >= 1e4) return `${(abs / 1e4).toFixed(2)}万手`;
  return `${abs.toFixed(0)}手`;
}

export function formatMv(yi: number | null | undefined): string {
  if (yi == null || Number.isNaN(yi)) return "--";
  if (Math.abs(yi) >= 1e4) return `${(yi / 1e4).toFixed(2)}万亿`;
  return `${yi.toFixed(2)}亿`;
}

export function toneClass(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-flat";
  return value > 0 ? "text-up" : "text-down";
}

export function toneBg(value: number | null | undefined): string {
  if (value == null || value === 0) return "bg-flat/10";
  return value > 0 ? "bg-up/12" : "bg-down/12";
}

export function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
    second: Number(pick("second")),
    weekday: pick("weekday"),
  };
}

export function formatClock(date = new Date()): string {
  const p = shanghaiParts(date);
  return `${p.year}-${p.month}-${p.day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`;
}
