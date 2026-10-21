import { holdSide, judgeBuyRisk, judgeOperation, shiftYmd, ymd } from "./companyAnalysis.ts";


function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(ymd("2026-09-21 00:00:00") === "2026-09-21", "date keeps the calendar day");
assert(shiftYmd("2026-10-21", -6) === "2026-04-21", "six months back stays on the 21st");
assert(holdSide("竞价交易", -1000) === "reduce", "a block sale is a reduction");
assert(holdSide("股权激励", 15000) === "increase", "an incentive grant is not a reduction");

const high = judgeBuyRisk({
  name: "ST示例",
  profitYoy: -40,
  debt: 80,
  peTtm: 90,
  recentReduce: true,
  upcomingLift: true,
  pendingSeo: true,
  eventHits: ["立案调查"],
});
assert(high.level === "high", "ST plus an investigation is high buy risk");

const calm = judgeBuyRisk({
  name: "立讯精密",
  profitYoy: 18,
  debt: 50,
  peTtm: 21,
  recentReduce: false,
  upcomingLift: false,
  pendingSeo: false,
  eventHits: ["三季报预披露"],
});
assert(calm.level === "low", "a clean tape is low buy risk");

const watch = judgeOperation({
  name: "立讯精密",
  profitYoy: -5,
  eventHits: ["预计2026年1-9月业绩预减"],
});
assert(watch.level === "watch", "a profit drop is a watch on operations");

const ok = judgeOperation({
  name: "立讯精密",
  profitYoy: 18,
  eventHits: ["于2026-10-30披露2026年三季报"],
});
assert(ok.level === "ok", "a rising profit with no risk event is not abnormal");

console.log("companyAnalysis.check ok");
