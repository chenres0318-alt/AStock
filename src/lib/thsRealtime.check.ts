import { thsRealtimeTradeDate, withToday } from "./thsRealtime.ts";
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

console.log("thsRealtime.check ok");
