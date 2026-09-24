import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "按急跌双底后涨停/大阳打开均线的买点特征筛选沪深A股",
};

export default function ScreenerPage() {
  return <Screener />;
}
