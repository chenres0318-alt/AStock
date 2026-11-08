import { mergeBoardMembers } from "./boardExtras";
import { cached, peekCached } from "./cache";
import { isTonghuashunBoard, isTonghuashunIndustry } from "./codes";
import { fetchBoardMembers } from "./sources/eastmoney";
import { fetchSinaBoardMembers, type SinaNodeSort } from "./sources/sina";
import { fetchTonghuashunConcepts, fetchTonghuashunIndustries, fetchTonghuashunMembers } from "./sources/tonghuashun";
import { fallbackIndustryBoards } from "./thsIndustryCatalog";
import type { BoardMember, SectorItem } from "./types";

export async function listIndustryBoards(): Promise<SectorItem[]> {
  return listAllIndustryBoards();
}

export async function listAllIndustryBoards(): Promise<SectorItem[]> {
  try {
    return await cached(
      "ths-industry-boards",
      3 * 60_000,
      () => fetchTonghuashunIndustries(),
      (rows) => rows.length >= 10,
    );
  } catch {
    const stale = peekCached<SectorItem[]>("ths-industry-boards");
    if (stale && stale.length >= 10) return stale;
    return fallbackIndustryBoards();
  }
}

export async function listTonghuashunConcepts(): Promise<SectorItem[]> {
  return fetchTonghuashunConcepts();
}

/** 板块页下拉：同花顺行业，再加上同花顺概念。 */
export async function listSelectableBoards(): Promise<SectorItem[]> {
  const industries = await listAllIndustryBoards();
  const concepts = await listTonghuashunConcepts().catch(() => [] as SectorItem[]);
  const seen = new Set(industries.map((item) => item.code));
  return [...industries, ...concepts.filter((item) => !seen.has(item.code))];
}

export async function listBoardMembers(
  boardCode: string,
  limit = 50,
  sort: "amount" | "turnover" = "amount",
): Promise<BoardMember[]> {
  const key = `board-members:v3:${boardCode}:${sort}:${limit}`;
  const rows = await cached(
    key,
    30 * 60_000,
    async () => {
      if (isTonghuashunBoard(boardCode)) {
        const fetched = await fetchTonghuashunMembers(boardCode, limit);
        if (!fetched.length && isTonghuashunIndustry(boardCode)) {
          throw new Error("同花顺行业成分股暂时读不到");
        }
        if (sort === "turnover") {
          return [...fetched].sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1));
        }
        return [...fetched].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
      }
      if (boardCode.startsWith("BK")) {
        try {
          const fetched = await fetchBoardMembers(boardCode, limit);
          if (fetched.length) return fetched;
        } catch {
          // fall through to Sina
        }
      }
      const sinaSort: SinaNodeSort = sort === "turnover" ? "turnoverratio" : "amount";
      return fetchSinaBoardMembers(boardCode, limit, sinaSort);
    },
    (rows) => rows.length >= 5,
  );
  return mergeBoardMembers(boardCode, rows);
}
