import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "不看板块红框，股价站上MA4，MA4>MA7>MA10且三根均线都比上一日高，周K呈MA4>MA7>MA10排列。持续时间按周K MA4>MA7>MA10连续周数，越短越靠前",
};

export default function ScreenerPage() {
  return <Screener />;
}
