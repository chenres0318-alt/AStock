import dns from "node:dns/promises";
import https from "node:https";
import iconv from "iconv-lite";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export class UpstreamError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "UpstreamError";
  }
}

function eastMoneyHost(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith("eastmoney.com") ? hostname : null;
  } catch {
    return null;
  }
}

function requestAddress(url: string, address: string, timeoutMs: number, referer?: string): Promise<Buffer> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: address,
        servername: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: {
          Host: parsed.hostname,
          "User-Agent": UA,
          Accept: "*/*",
          Referer: referer ?? "https://finance.qq.com/",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) reject(new UpstreamError(`上游 ${res.statusCode}`, res.statusCode ?? 502));
          else resolve(Buffer.concat(chunks));
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new UpstreamError("上游超时"));
    });
    req.on("error", (error) => reject(error));
    req.end();
  });
}

export async function fetchEastMoneyAddresses(url: string, timeoutMs: number, referer?: string): Promise<Buffer | null> {
  const hostname = eastMoneyHost(url);
  if (!hostname) return null;
  let addresses: string[] = [];
  try {
    const records = await dns.lookup(hostname, { all: true, family: 4 });
    addresses = records.map((item) => item.address).slice(0, 3);
  } catch {
    return null;
  }
  for (const address of addresses) {
    try {
      return await requestAddress(url, address, Math.min(timeoutMs, 3000), referer);
    } catch {
      // 同一个域名往往有多台机器，换下一个地址。
    }
  }
  return null;
}

export async function fetchBuffer(
  url: string,
  init: RequestInit & { timeoutMs?: number; referer?: string } = {},
): Promise<Buffer> {
  const { timeoutMs = 8000, referer, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        Referer: referer ?? "https://finance.qq.com/",
        ...(rest.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new UpstreamError(`上游 ${res.status}`, res.status);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError("上游超时");
    }
    throw new UpstreamError(error instanceof Error ? error.message : "上游请求失败");
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGbk(url: string, init?: RequestInit & { timeoutMs?: number; referer?: string }) {
  const buf = await fetchBuffer(url, init);
  return iconv.decode(buf, "gbk");
}

export async function fetchUtf(url: string, init?: RequestInit & { timeoutMs?: number; referer?: string }) {
  const buf = await fetchBuffer(url, init);
  return buf.toString("utf8");
}

export async function retryOk<T>(times: number, task: () => Promise<T>): Promise<T> {
  let last: unknown;
  const attempts = Math.max(1, times);
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await task();
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new UpstreamError("全部重试失败");
}

export async function fetchJson<T>(url: string, init?: RequestInit & { timeoutMs?: number; referer?: string }): Promise<T> {
  const text = await fetchUtf(url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError("上游返回不是 JSON");
  }
}

export async function firstOk<T>(tasks: Array<() => Promise<T>>): Promise<T> {
  let last: unknown;
  for (const task of tasks) {
    try {
      return await task();
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new UpstreamError("全部数据源失败");
}
