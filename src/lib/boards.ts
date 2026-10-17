import { cached } from "./cache";
import { isTonghuashunBoard } from "./codes";
import { fetchBoardMembers } from "./sources/eastmoney";
import { fetchSinaBoardMembers, type SinaNodeSort } from "./sources/sina";
import { fetchTonghuashunConcepts, fetchTonghuashunIndustries, fetchTonghuashunMembers } from "./sources/tonghuashun";
import type { BoardMember, SectorItem } from "./types";

export async function listIndustryBoards(): Promise<SectorItem[]> {
  return listAllIndustryBoards();
}

export async function listAllIndustryBoards(): Promise<SectorItem[]> {
  return cached("ths-industry-boards", 3 * 60_000, () => fetchTonghuashunIndustries());
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
  const key = `board-members:${boardCode}:${sort}:${limit}`;
  return cached(key, 30 * 60_000, async () => {
    if (isTonghuashunBoard(boardCode)) {
      const rows = await fetchTonghuashunMembers(boardCode, limit);
      if (sort === "turnover") {
        return [...rows].sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1));
      }
      return [...rows].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
    }
    if (boardCode.startsWith("BK")) {
      try {
        const rows = await fetchBoardMembers(boardCode, limit);
        if (rows.length) return rows;
      } catch {
        // fall through to Sina
      }
    }
    const sinaSort: SinaNodeSort = sort === "turnover" ? "turnoverratio" : "amount";
    return fetchSinaBoardMembers(boardCode, limit, sinaSort);
  });
}
