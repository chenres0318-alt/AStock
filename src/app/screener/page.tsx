import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "先筛行业板块，再按 MA5 / MACD 缩绿柱规则挑选成分股",
};

export default function ScreenerPage() {
  return <Screener />;
}
