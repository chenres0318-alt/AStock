import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "先筛近期首次站上五日线、MACD 靠近 0 轴的行业板块，再挑成分股",
};

export default function ScreenerPage() {
  return <Screener />;
}
