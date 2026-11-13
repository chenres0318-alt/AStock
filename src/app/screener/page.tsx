import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "不看板块红框，股价站上MA4，MA4>MA7>MA10且三根均线都比上一日高，持续时间越短越靠前",
};

export default function ScreenerPage() {
  return <Screener />;
}
