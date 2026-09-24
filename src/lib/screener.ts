import { cached } from "./cache";
import { isHsAShare } from "./codes";
import { analyzeBars, passesScreen, screenReasons, type ScreenFlags } from "./indicators";
import { mapPool } from "./pool";
import { fetchEastMoneyAmountRank } from "./sources/eastmoney";
import { fetchSinaHsAByAmount, fetchSinaKline } from "./sources/sina";
import { fetchTencentKline } from "./sources/tencent";
import type { KBar, RankItem, ScreenerHit } from "./types";

const SCAN_DEADLINE_MS = 95_000;
const UNIVERSE_SIZE = 360;
const KLINE_CONCURRENCY = 8;
const MIN_BARS = 40;

async function stockKline(code: string): Promise<KBar[]> {
  try {
    return await cached(`screener-kline:${code}`, 10 * 60_000, async () => {
      try {
        const bars = await fetchTencentKline(code, "day", 90);
        if (bars.length >= MIN_BARS) return bars;
      } catch {
        // try Sina
      }
      const bars = await fetchSinaKline(code, 90);
      if (bars.length >= MIN_BARS) return bars;
      throw new Error(`kline unavailable: ${code}`);
    });
  } catch {
    return [];
  }
}

async function liquidUniverse(limit: number): Promise<{ items: RankItem[]; source: string }> {
  try {
    const rows = await fetchSinaHsAByAmount(limit);
    if (rows.length >= 80) return { items: rows, source: "sina" };
  } catch {
    // fall through
  }
  try {
    const rows = await fetchEastMoneyAmountRank(limit);
    if (rows.length) return { items: rows, source: "eastmoney" };
  } catch {
    // empty
  }
  return { items: [], source: "unknown" };
}

function toHit(
  tech: ScreenFlags,
  meta: { code: string; name: string; price?: number | null; pct: number | null; turnover: number | null },
): ScreenerHit {
  return {
    code: meta.code,
    name: meta.name,
    price: meta.price ?? tech.close,
    pct: meta.pct ?? tech.dayPct,
    turnover: meta.turnover,
    amplitudePct: tech.amplitudePct,
    ma5: tech.ma5,
    dif: tech.dif,
    dea: tech.dea,
    hist: tech.hist,
    reasons: screenReasons(tech),
  };
}

export async function screenStocks(): Promise<{
  scanned: number;
  universe: number;
  items: ScreenerHit[];
  source: string;
}> {
  const { items: ranked, source } = await liquidUniverse(UNIVERSE_SIZE);
  const candidates = ranked.filter((item) => isHsAShare(item.code, item.name));
  const deadline = Date.now() + SCAN_DEADLINE_MS;

  await mapPool(candidates, KLINE_CONCURRENCY, async (item) => {
    if (Date.now() > deadline) return;
    try {
      await stockKline(item.code);
    } catch {
      // skip
    }
  });

  const items: ScreenerHit[] = [];
  let scanned = 0;
  for (const item of candidates) {
    if (Date.now() > deadline) break;
    scanned += 1;
    try {
      const bars = await stockKline(item.code);
      if (bars.length < MIN_BARS) continue;
      const last = bars[bars.length - 1];
      if (!last.volume) continue;
      const tech = analyzeBars(bars);
      if (!tech || !passesScreen(tech)) continue;
      items.push(
        toHit(tech, {
          code: item.code,
          name: item.name,
          price: item.price ?? tech.close,
          pct: item.pct ?? tech.dayPct,
          turnover: item.turnover,
        }),
      );
    } catch {
      // skip stock
    }
  }

  items.sort((a, b) => (b.hist ?? -Infinity) - (a.hist ?? -Infinity));
  return { scanned, universe: candidates.length, items, source };
}
