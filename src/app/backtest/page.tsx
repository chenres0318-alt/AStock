import BuyPointBacktest from "@/components/BuyPointBacktest";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "回测 · AStock 看盘",
  description: "选股命中票按买点买卖：2010–2015 与 2020–2026 的胜率、回撤、盈亏比、期望值",
};

export default function BacktestPage() {
  return <BuyPointBacktest />;
}
