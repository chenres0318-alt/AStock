import { cached } from "./cache";
import { fetchBoardMembers, fetchIndustryBoards } from "./sources/eastmoney";
import { fetchSinaBoardMembers, fetchSinaIndustries, type SinaNodeSort } from "./sources/sina";
import type { BoardMember, SectorItem } from "./types";

export async function listIndustryBoards(): Promise<SectorItem[]> {
  return cached("industry-boards", 10 * 60_000, async () => {
    const sina = await fetchSinaIndustries().catch(() => [] as SectorItem[]);
    if (sina.length >= 10) return sina;
    try {
      const em = await fetchIndustryBoards();
      const boards = em.filter((item) => item.code.startsWith("BK"));
      if (boards.length >= 10) return boards;
    } catch {
      // East Money is optional
    }
    if (sina.length) return sina;
    return [];
  });
}

export async function listBoardMembers(
  boardCode: string,
  limit = 50,
  sort: "amount" | "turnover" = "amount",
): Promise<BoardMember[]> {
  const key = `board-members:${boardCode}:${sort}:${limit}`;
  return cached(key, 30 * 60_000, async () => {
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
