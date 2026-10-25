type ExtraMember = {
  code: string;
  name: string;
  price: number | null;
  pct: number | null;
  amount: number | null;
  turnover: number | null;
};

function memberId(code: string): string {
  return code.replace(/\D/g, "").slice(-6);
}

/** 同花顺行业成分按成交额只取前几十只；这些名字始终并进对应板块。 */
export const BOARD_MEMBER_EXTRAS: Array<{
  boardCode: string;
  boardName: string;
  code: string;
  name: string;
}> = [{ boardCode: "881121", boardName: "半导体", code: "600206", name: "有研新材" }];

function extraRows(boardCode: string): ExtraMember[] {
  return BOARD_MEMBER_EXTRAS.filter((item) => item.boardCode === boardCode).map((item) => ({
    code: item.code,
    name: item.name,
    price: null,
    pct: null,
    amount: null,
    turnover: null,
  }));
}

/** 附加成分放在名单前面，避免被成交额排序挤到表底。已在上游名单里的不再重复。 */
export function mergeBoardMembers(boardCode: string, rows: ExtraMember[]): ExtraMember[] {
  const extras = extraRows(boardCode);
  if (!extras.length) return rows;
  const seen = new Set(rows.map((row) => memberId(row.code)));
  const extra = extras.filter((item) => !seen.has(memberId(item.code)));
  return extra.length ? [...extra, ...rows] : rows;
}

export function forcedBoardForStock(code: string): { sector: string; sectorCode: string } | null {
  const id = memberId(code);
  const hit = BOARD_MEMBER_EXTRAS.find((item) => memberId(item.code) === id);
  return hit ? { sector: hit.boardName, sectorCode: hit.boardCode } : null;
}
