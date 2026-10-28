import {
  keepTonghuashunHoldingBoard,
  matchBoardFromHoldingName,
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

const oilBoards = [board("881107", "油气开采及服务"), board("881180", "石油加工贸易"), board("881268", "工程机械"), ...boards];
assert(
  parseTonghuashunSwIndustry(
    `<td><strong class="hltip fl">所属申万行业：</strong><span>石油石化 — 油服工程</span></td>`,
  ) === "石油石化 — 油服工程",
  "海油工程 keeps the Shenwan 油服工程 path",
);
assert(
  parseTonghuashunSwIndustry(`所属申万行业：</span> <span class="tip f14">油服工程</span>`) === "油服工程",
  "the F10 home page still yields the Shenwan leaf",
);
assert(
  matchTonghuashunIndustry("石油石化 — 油服工程", oilBoards)?.name === "油气开采及服务",
  "油服工程 maps onto 油气开采及服务 rather than 石油加工贸易 or 工程机械",
);
assert(
  matchTonghuashunIndustry("电子 — 元件", [board("881270", "元件"), board("881123", "其他电子"), ...boards])?.name ===
    "元件",
  "东山精密 maps onto 元件",
);

const etfBoards = [
  board("881121", "半导体"),
  board("881129", "通信设备"),
  board("881162", "通信服务"),
  board("881270", "元件"),
  ...boards,
];
assert(
  matchBoardFromHoldingName("半导体ETF国联安", etfBoards)?.name === "半导体",
  "国联安半导体 ETF maps onto 半导体",
);
assert(
  matchBoardFromHoldingName("半导体设备ETF国泰", etfBoards)?.name === "半导体",
  "半导体设备 ETF still uses 半导体 rather than a unique fuzzy miss",
);
assert(
  matchBoardFromHoldingName("通信ETF国泰", etfBoards)?.name === "通信设备",
  "通信 ETF maps onto 通信设备 rather than 通信服务",
);

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
