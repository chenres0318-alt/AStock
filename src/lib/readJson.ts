export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export async function readJson<T>(
  url: string,
  init: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 12_000;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (init.signal) signals.push(init.signal);
  const res = await fetch(url, {
    cache: "no-store",
    signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}
