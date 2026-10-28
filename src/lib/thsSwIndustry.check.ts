import {
  keepTonghuashunHoldingBoard,
  matchTonghuashunIndustry,
  parseTonghuashunSwIndustry,
  swIndustryCandidates,
} from "./thsSwIndustry.ts";
import type { SectorItem } from "./types.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function board(code: string, name: string): SectorItem {
  return {
    code,
    name,
    pct: null,
    price: null,
    leader: null,
    leaderCode: null,
    upCount: null,
    downCount: null,
    source: "ths",
  };
}

const boards = [
  board("881121", "白酒"),
  board("881157", "半导体"),
  board("881171", "自动化设备"),
  board("881128", "汽车服务及其他"),
  board("881125", "汽车整车"),
  board("881126", "汽车零部件"),
];

const company = `
<td><strong class="hltip fl">所属申万行业：</strong><span>汽车 — 汽车零部件</span> </td>
<td><strong class="hltip fl">所属申万行业：</strong><span>传媒 — 游戏Ⅱ</span></td>
`;
assert(parseTonghuashunSwIndustry(company) === "汽车 — 汽车零部件", "the company page keeps the Shenwan industry path");
assert(
  parseTonghuashunSwIndustry(`<strong>所属申万行业：</strong><span>食品饮料 — 白酒Ⅱ</span>`) === "食品饮料 — 白酒Ⅱ",
  "a liquor name still keeps the Ⅱ suffix for later matching",
);
assert(parseTonghuashunSwIndustry(`<strong>所属申万行业：</strong><span>-</span>`) == null, "a blank Shenwan field is ignored");
assert(parseTonghuashunSwIndustry("<div>no field</div>") == null, "a page without Shenwan industry returns null");

assert(
  swIndustryCandidates("汽车 — 汽车零部件").join(",") === "汽车零部件,汽车",
  "Shenwan paths try the leaf industry first",
);
assert(swIndustryCandidates("食品饮料 — 白酒Ⅱ").includes("白酒"), "Shenwan Ⅱ suffixes are stripped for matching");
assert(
  matchTonghuashunIndustry("汽车 — 汽车零部件", boards)?.name === "汽车零部件",
  "贵航 maps onto 汽车零部件 rather than 汽车服务及其他",
);
assert(
  matchTonghuashunIndustry("电子 — 半导体", boards)?.code === "881157",
  "有研 maps onto the Tonghuashun 半导体 board",
);
assert(
  matchTonghuashunIndustry("食品饮料 — 白酒Ⅱ", boards)?.name === "白酒",
  "茅台 maps onto 白酒 after dropping Ⅱ",
);
assert(
  matchTonghuashunIndustry("传媒 — 游戏Ⅱ", [board("881275", "游戏"), board("881164", "文化传媒"), ...boards])?.name ===
    "游戏",
  "巨人 maps onto the Tonghuashun 游戏 board",
);
assert(
  matchTonghuashunIndustry("传媒 — 游戏Ⅱ", [board("881164", "文化传媒"), ...boards])?.name === "文化传媒",
  "a missing leaf uniquely falls back to 文化传媒",
);
assert(
  matchTonghuashunIndustry("银行 — 股份制银行Ⅱ", [board("881155", "银行"), ...boards])?.name === "银行",
  "a bank leaf that is not on the 881 list still uses 银行",
);
assert(matchTonghuashunIndustry("汽车", boards) == null, "a bare 汽车 parent does not pick 汽车服务及其他");

const ths = keepTonghuashunHoldingBoard(
  { sector: "汽车行业", sectorCode: "BK0476" },
  { sector: "汽车零部件", sectorCode: "881126" },
);
assert(ths.sector === "汽车零部件" && ths.sectorCode === "881126", "a live Tonghuashun match replaces the stored East Money board");

const kept = keepTonghuashunHoldingBoard({ sector: "汽车零部件", sectorCode: "881126" }, null);
assert(kept.sectorCode === "881126", "a stored 881 board is kept when the company page is down");

const dropped = keepTonghuashunHoldingBoard({ sector: "汽车行业", sectorCode: "BK0476" }, null);
assert(dropped.sectorCode == null, "an East Money board is not used as a holdings sector");

const empty = keepTonghuashunHoldingBoard({ sector: null, sectorCode: null }, null);
assert(empty.sectorCode == null, "a search-added name without a board stays without one");

console.log("thsSwIndustry.check ok");
