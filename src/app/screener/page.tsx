import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "近5日首次站上五日线、MACD多头或空头减弱筛选沪深A股",
};

export default function ScreenerPage() {
  return <Screener />;
}
