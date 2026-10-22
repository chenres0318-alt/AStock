import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "当天收盘站上4日、7日均线，两条均线拐头向上，且连续成立不超过2日",
};

export default function ScreenerPage() {
  return <Screener />;
}
