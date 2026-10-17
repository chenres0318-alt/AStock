/** 模拟分时顶底。不是同花顺的公式，只按分时价、当日均价和下一分钟的转折来标。 */

const LOOK = 8;
const MIN_GAP = 10;
/** 相对昨收，价格至少要偏离均价这么多，才像一次顶或底。 */
const STRETCH = 0.006;
/** 下一分钟至少要往回走这么多，这一分钟的极值才算走完。 */
const TURN = 0.0015;
/** 全天振幅不到这个幅度，不标。 */
const MIN_RANGE = 0.012;

export type IntradayMinute = {
  time: string;
  price: number;
  avg: number | null;
};

export type IntradayMark = {
  index: number;
  time: string;
  side: "bottom" | "top";
  price: number;
};

function isWindowExtreme(prices: number[], index: number, side: "bottom" | "top"): boolean {
  const from = Math.max(0, index - LOOK);
  for (let j = from; j <= index; j += 1) {
    if (side === "bottom" && prices[j] < prices[index]) return false;
    if (side === "top" && prices[j] > prices[index]) return false;
  }
  return true;
}

function returnedToAvg(points: IntradayMinute[], from: number, to: number, side: "bottom" | "top"): boolean {
  for (let j = from + 1; j < to; j += 1) {
    const avg = points[j].avg;
    if (avg == null) continue;
    if (side === "bottom" && points[j].price >= avg) return true;
    if (side === "top" && points[j].price <= avg) return true;
  }
  return false;
}

export function intradayExtremes(points: IntradayMinute[], preClose: number | null): IntradayMark[] {
  if (points.length < LOOK + 2) return [];
  const ref = preClose != null && preClose > 0 ? preClose : points[0].price;
  if (!(ref > 0)) return [];
  let high = points[0].price;
  let low = points[0].price;
  for (const point of points) {
    if (point.price > high) high = point.price;
    if (point.price < low) low = point.price;
  }
  if ((high - low) / ref < MIN_RANGE) return [];

  const prices = points.map((point) => point.price);
  const marks: IntradayMark[] = [];
  let lastIndex = -MIN_GAP;
  let lastSide: "bottom" | "top" | null = null;

  for (let i = LOOK; i < points.length - 1; i += 1) {
    const avg = points[i].avg;
    if (avg == null || !(avg > 0)) continue;
    const stretch = (points[i].price - avg) / ref;
    const turn = (points[i + 1].price - points[i].price) / ref;
    let side: "bottom" | "top" | null = null;
    if (stretch <= -STRETCH && turn >= TURN && isWindowExtreme(prices, i, "bottom")) side = "bottom";
    else if (stretch >= STRETCH && turn <= -TURN && isWindowExtreme(prices, i, "top")) side = "top";
    if (!side) continue;
    if (i - lastIndex < MIN_GAP) continue;
    if (lastSide === side && !returnedToAvg(points, lastIndex, i, side)) continue;
    marks.push({ index: i, time: points[i].time, side, price: points[i].price });
    lastIndex = i;
    lastSide = side;
  }
  return marks;
}
