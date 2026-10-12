import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "当天4日均线上穿7日均线，且MACD空头势力减弱",
};

export default function ScreenerPage() {
  return <Screener />;
}
