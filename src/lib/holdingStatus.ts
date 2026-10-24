import { adviseHolding, closeStandsOnMa4, consecutiveMa4Days, sectorHasOpenRedBox } from "./holdingAdvice";
import { toTencentCode } from "./codes";
import { getKline } from "./market";
import { mapPool } from "./pool";
import { getSectorTrend, type SectorTrendReport } from "./sectorTrendData";
import type { HoldingItem, HoldingStatus, KBar } from "./types";

export async function evaluateHoldings(items: HoldingItem[]): Promise<HoldingStatus[]> {
  const rows = items.map((item) => ({
    code: toTencentCode(item.code),
    name: item.name,
    sector: item.sector,
    sectorCode: item.sectorCode?.trim() || null,
  }));
  const unique = [...new Set(rows.map((row) => row.sectorCode).filter((code): code is string => Boolean(code)))];
  const reports = new Map<string, SectorTrendReport | null>();
  await mapPool(unique, 3, async (code) => {
    try {
      reports.set(code, await getSectorTrend(code));
    } catch {
      reports.set(code, null);
    }
  });

  return mapPool(rows, 4, async (item) => {
    let bars: KBar[] = [];
    try {
      bars = await getKline(item.code, "day");
    } catch {
      bars = [];
    }
    const stockOnMa4 = closeStandsOnMa4(bars);
    const standDays = consecutiveMa4Days(bars);
    const report = item.sectorCode ? reports.get(item.sectorCode) ?? null : null;
    const sectorOnMa4 = report?.onMa4 ?? false;
    const sectorInRedBox = report ? sectorHasOpenRedBox(report) : false;
    const advice = adviseHolding({
      stockOnMa4,
      sectorOnMa4,
      sectorInRedBox,
      hasSector: Boolean(item.sectorCode),
      sectorResolved: item.sectorCode ? report != null : false,
      standDays,
    });
    return {
      code: item.code,
      standDays: stockOnMa4 ? standDays : 0,
      sector: report?.board.name ?? item.sector,
      sectorCode: item.sectorCode,
      ...advice,
    };
  });
}
