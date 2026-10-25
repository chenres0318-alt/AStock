import Holdings from "@/components/Holdings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "持仓 · AStock 看盘",
  description: "从选股加入的持仓，对照看盘图，按红框和MA4提示继续持仓或离场",
};

export default function HoldingsPage() {
  return <Holdings />;
}
