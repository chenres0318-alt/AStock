import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "五日线拐头向上、放量红柱站上五日线、换手和振幅筛选沪深A股",
};

export default function ScreenerPage() {
  return <Screener />;
}
