import { forcedBoardForStock } from "./boardExtras";
import { listAllIndustryBoards } from "./boards";
import { cached } from "./cache";
import { bareCode, isEtf, toTencentCode } from "./codes";
import { adviseHolding, closeStandsOnMa4, consecutiveMa4Days, sectorHasOpenRedBox } from "./holdingAdvice";
import { getKline } from "./market";
import { mapPool } from "./pool";
import { getSectorTrend, type SectorTrendReport } from "./sectorTrendData";
import { fetchTonghuashunFieldIndustry, fetchTonghuashunStockIndustry } from "./sources/tonghuashun";
import {
  keepTonghuashunHoldingBoard,
  matchBoardFromHoldingName,
  matchTonghuashunIndustry,
} from "./thsSwIndustry";
import type { HoldingItem, HoldingStatus, KBar } from "./types";

export async function resolveHoldingBoard(
  code: string,
  name = "",
): Promise<{ sector: string; sectorCode: string } | null> {
  const forced = forcedBoardForStock(code);
  if (forced) return forced;
  try {
    const boards = await listAllIndustryBoards();
    if (isEtf(code, name)) {
      const board = matchBoardFromHoldingName(name, boards);
      if (!board) return null;
      return { sector: board.name, sectorCode: board.code };
    }
    const fieldCode = await cached(`holding-ths-field:v1:${bareCode(code)}`, 6 * 60 * 60_000, async () => {
      const found = await fetchTonghuashunFieldIndustry(code);
      if (!found) throw new Error("no ths field");
      return found;
    }).catch(() => null);
    if (fieldCode) {
      const board = boards.find((item) => item.code === fieldCode);
      return { sector: board?.name ?? fieldCode, sectorCode: fieldCode };
    }
    const industry = await cached(`holding-ths-industry:v2:${bareCode(code)}`, 6 * 60 * 60_000, async () => {
      const found = await fetchTonghuashunStockIndustry(code);
      if (!found) throw new Error("no shenwan industry");
      return found;
    }).catch(() => null);
    if (!industry) return null;
    const board = matchTonghuashunIndustry(industry, boards);
    if (!board) return null;
    return { sector: board.name, sectorCode: board.code };
  } catch {
    return null;
  }
}

export async function evaluateHoldings(items: HoldingItem[]): Promise<HoldingStatus[]> {
  const seeded = items.map((item) => ({
    code: toTencentCode(item.code),
    name: item.name,
    sector: item.sector,
    sectorCode: item.sectorCode?.trim() || null,
  }));
  const rows = await mapPool(seeded, 4, async (item) => {
    const board = await resolveHoldingBoard(item.code, item.name);
    return { ...item, ...keepTonghuashunHoldingBoard(item, board) };
  });
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
