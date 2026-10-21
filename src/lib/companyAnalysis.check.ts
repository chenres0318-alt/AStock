import {
  aboutCompany,
  classifySentiment,
  fromMillis,
  holdSide,
  judgeBuyRisk,
  judgeOperation,
  pickSentiment,
  shiftYmd,
  ymd,
} from "./companyAnalysisLogic.ts";


function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(ymd("2026-09-21 00:00:00") === "2026-09-21", "date keeps the calendar day");
assert(fromMillis(1792578719000) === "2026-10-21", "east money news timestamps stay on the Shanghai day");
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

assert(classifySentiment("预计2026年1-9月业绩略增，同比上升15%") === "bull", "a slight profit rise is bullish");
assert(classifySentiment("关于股份回购进展情况的公告") === "bull", "a buyback is bullish");
assert(classifySentiment("2026年半年度权益分派实施公告") === "bull", "a dividend is bullish");
assert(classifySentiment("对公司开展337调查的公告") === "bear", "a 337 probe is bearish");
assert(classifySentiment("董事减持1000股") === "bear", "an insider sale is bearish");
assert(classifySentiment("于2026-10-30披露2026年三季报") === "neutral", "a filing calendar is not a catalyst");
assert(classifySentiment("关于立讯转债恢复转股的公告") === "neutral", "resuming conversion is not a catalyst");
assert(classifySentiment("摩根大通在立讯精密的H股好仓比例上升0.03%") === "bull", "a rising long book is bullish");
assert(classifySentiment("摩根大通在立讯精密的H股好仓比例下降0.06%") === "bear", "a falling long book is bearish");

assert(aboutCompany("立讯精密：公司累计回购股份", "", "立讯精密", "sz002475"), "own headlines count");
assert(
  !aboutCompany("永茂泰：与立讯精密、小鹏等开展镁合金产品合作", "", "立讯精密", "sz002475"),
  "a supplier headline about this company does not count",
);
assert(aboutCompany("摩根大通在立讯精密的H股好仓比例上升", "", "立讯精密", "sz002475"), "a holder note still counts");

const picked = pickSentiment(
  [
    { date: "2026-10-16", title: "立讯精密:关于股份回购进展情况的公告", summary: "公司公告", source: "notice" },
    { date: "2026-10-12", title: "立讯精密:关于337调查的公告", summary: "公司公告", source: "notice" },
    { date: "2026-10-12", title: "美国启动337调查，立讯精密、工业富联受挫", summary: "资讯", source: "news" },
    { date: "2026-10-16", title: "立讯精密发布公告 关于股份回购进展情况", summary: "资讯", source: "news" },
    { date: "2026-10-19", title: "永茂泰：与立讯精密合作量产", summary: "永茂泰公告", source: "news" },
    { date: "2026-10-30", title: "于2026-10-30披露2026年三季报", summary: "报表披露", source: "event" },
  ],
  "立讯精密",
  "sz002475",
);
assert(picked.bullish.length === 1, "buyback news is deduped into one bullish item");
assert(picked.bullish[0].title.includes("回购"), "the kept bullish item is the buyback");
assert(picked.bearish.length === 1, "the 337 notice stays bearish");
assert(picked.bearish[0].title.includes("337"), "the kept bearish item is the probe");
assert(picked.bearish[0].source === "notice", "the company notice wins over copycat news");

console.log("companyAnalysis.check ok");
