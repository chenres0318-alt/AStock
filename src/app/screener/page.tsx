import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "当天4日均线上穿7日均线，且4日、7日均线都拐头向上",
};

export default function ScreenerPage() {
  return <Screener />;
}
