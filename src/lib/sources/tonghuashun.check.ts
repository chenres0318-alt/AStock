import { parseTonghuashunIndustryHtml } from "./tonghuashun.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const hyzjl = `
<table><tbody>
<tr>
  <td>1</td>
  <td><a href="http://q.10jqka.com.cn/thshy/detail/code/881171/" target="_blank">自动化设备</a></td>
  <td>26099.7</td>
  <td>4.09%</td>
  <td>129.41</td>
  <td>114.21</td>
  <td>15.20</td>
  <td>99</td>
  <td><a href="http://stockpage.10jqka.com.cn/920096/" target="_blank">嘉晨智能</a></td>
  <td>29.98%</td>
  <td>35.77</td>
</tr>
</tbody></table>
`;

const quoted = `
<table><tbody>
<tr>
  <td>1</td>
  <td><a href="https://q.10jqka.com.cn/thshy/detail/code/881121/">半导体</a></td>
  <td>2.92</td>
  <td>13900</td>
  <td>1</td>
  <td>2</td>
  <td>120</td>
  <td>10</td>
  <td>3</td>
  <td><a href="https://q.10jqka.com.cn/code/688608/">恒玄科技</a></td>
</tr>
</tbody></table>
`;

const fund = parseTonghuashunIndustryHtml(hyzjl);
assert(fund.length === 1 && fund[0].code === "881171" && fund[0].name === "自动化设备", "the fund-flow table still names the industry");
assert(fund[0].pct === 4.09 && fund[0].leader === "嘉晨智能" && fund[0].leaderCode === "920096", "the fund-flow row keeps the rise and the leader");
assert(fund[0].upCount == null, "the fund-flow table does not have up and down counts");

const quote = parseTonghuashunIndustryHtml(quoted)[0];
assert(quote?.code === "881121" && quote.pct === 2.92 && quote.leader === "恒玄科技", "the quote table still reads percent from the third cell");
assert(quote.upCount === 120 && quote.downCount === 10, "the quote table still keeps the up and down counts");

console.log("tonghuashun.check ok", fund[0].name, quote.name);
