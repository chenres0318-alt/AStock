import Holdings from "@/components/Holdings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "持仓 · AStock 看盘",
  description: "持仓三项：股价日K高于MA4、板块概念红框、股价高于昨日；两项及以上不满足则离场清仓",
};

export default function HoldingsPage() {
  return <Holdings />;
}
