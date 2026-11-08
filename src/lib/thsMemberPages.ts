/** 板块页龙头名单仍只取成交额靠前的一小段。 */
export const TREND_BOARD_MEMBER_LIMIT = 40;
/** 选股扫红框行业/概念的主板成分股上限，覆盖多数板块全名单。 */
export const SCREENER_BOARD_MEMBER_LIMIT = 300;
export const THS_MEMBER_PER_PAGE = 10;
export const THS_MEMBER_MAX_PAGES = 30;

/** 同花顺成分股每页约 10 只。 */
export function tonghuashunMemberPageCount(
  limit: number,
  perPage = THS_MEMBER_PER_PAGE,
  maxPages = THS_MEMBER_MAX_PAGES,
): number {
  return Math.min(maxPages, Math.max(1, Math.ceil(limit / perPage)));
}
