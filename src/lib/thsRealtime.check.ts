import { alignedLivePrice, thsRealtimeTradeDate, withLiveClose, withToday } from "./thsRealtime.ts";
import type { KBar } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(
  thsRealtimeTradeDate({ time: "2026-10-23 15:01:00 北京时间", updateTime: "2026-10-23 15:00" }) === "2026-10-23",
  "a weekday clock keeps the session date",
);
assert(
  thsRealtimeTradeDate({ time: "2026-10-24 00:25:20 北京时间", updateTime: "2026-10-23 15:00" }) === "2026-10-23",
  "after the close on Saturday the bar still belongs to Friday",
);
assert(
  thsRealtimeTradeDate({ time: "2026-10-26 09:31:00 北京时间", updateTime: "2026-10-23 15:00" }) === "2026-10-26",
  "Monday morning uses the weekday clock for the new session",
);
assert(
  thsRealtimeTradeDate({ time: "2026-10-24 00:25:20 北京时间", updateTime: "2026-10-25 15:00" }) == null,
  "a Saturday clock with a Sunday update is not a session date",
);

const friday: KBar = {
  time: "2026-10-23",
  open: 13240,
  high: 14088,
  low: 12788,
  close: 14029,
  volume: 1,
};
const saturdayClone: KBar = { ...friday, time: "2026-10-24" };
assert(withToday([friday], saturdayClone).at(-1)?.time === "2026-10-23", "a weekend clone of Friday is not appended");
assert(withToday([friday], friday).length === 1 && withToday([friday], friday)[0].close === 14029, "the same session replaces the last bar");
const sundayDrift: KBar = { ...friday, time: "2026-10-25", close: 14100 };
assert(withToday([friday], sundayDrift).at(-1)?.time === "2026-10-23", "a weekend bar with a different close is still dropped");

assert(alignedLivePrice(10.21, 10.21) === 10.21, "the same-session print is kept");
assert(alignedLivePrice(9.5, 10.21) === 9.5, "a live dump under the last close is still the spot");
assert(alignedLivePrice(18.23, 10.21) == null, "an unadjusted quote far above the qfq close is dropped");
assert(alignedLivePrice(1, 20) === 1, "a live print collapsing under MA4 is not treated as a bad quote");

const thruNov10: KBar[] = [
  { time: "2026-11-06", open: 9.85, high: 9.85, low: 9.85, close: 9.85, volume: 0 },
  { time: "2026-11-09", open: 9.8, high: 9.8, low: 9.8, close: 9.8, volume: 0 },
  { time: "2026-11-10", open: 9.82, high: 9.82, low: 9.82, close: 9.82, volume: 0 },
];
const liveToday = withLiveClose(thruNov10, 10.21, "2026-11-11");
assert(liveToday.at(-1)?.time === "2026-11-11" && liveToday.at(-1)?.close === 10.21, "a later session appends today's live close");
assert(liveToday.at(-2)?.close === 9.82, "yesterday's close stays on its own bar");
assert(withLiveClose(thruNov10, 9.9, "2026-11-10").at(-1)?.close === 9.9, "the same session replaces the last close");
assert(withLiveClose(thruNov10, 18.23, "2026-11-11").at(-1)?.time === "2026-11-10", "a mismatched unadjusted quote is not appended");

console.log("thsRealtime.check ok");
