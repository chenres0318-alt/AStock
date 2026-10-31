import { dailyToMonthly, dailyToWeekly } from "../screenerLogic";
import { fetchJson } from "../http";
import type { KBar, KlinePeriod } from "../types";
import { parseSinaFuturesKline } from "./sinaKlineParse";

export { parseSinaFuturesKline };

function takeTail(bars: KBar[], count: number): KBar[] {
  return bars.length > count ? bars.slice(bars.length - count) : bars;
}

/** 新浪外盘期货日 K，周/月由日 K 折叠。GC 纽约黄金、CL 纽约原油、NK 日经期货。 */
export async function fetchSinaFuturesKline(symbol: string, period: KlinePeriod, count = 400): Promise<KBar[]> {
  const url =
    `https://stock2.finance.sina.com.cn/futures/api/json.php/` +
    `GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${encodeURIComponent(symbol)}`;
  const raw = await fetchJson<unknown>(url, { referer: "https://finance.sina.com.cn/", timeoutMs: 12_000 });
  const daily = parseSinaFuturesKline(raw);
  if (!daily.length) return [];
  if (period === "week") return takeTail(dailyToWeekly(daily), Math.min(count, 180));
  if (period === "month") return takeTail(dailyToMonthly(daily), Math.min(count, 180));
  return takeTail(daily, count);
}
