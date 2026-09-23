import BacktestReport from "@/components/BacktestReport";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "回测 · AStock 看盘",
  description: "2010–2015 与 2020–2026 日线 T+1 策略对比：盈亏比、收益率、最大回撤",
};

export default function BacktestPage() {
  return <BacktestReport />;
}
