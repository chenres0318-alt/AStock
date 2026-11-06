import Holdings from "@/components/Holdings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "持仓 · AStock 看盘",
  description: "搜索或从选股加入持仓，个股与板块指数同时跌破MA4才提示离场",
};

export default function HoldingsPage() {
  return <Holdings />;
}
