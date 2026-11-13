import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "行业和概念都在红框，日K站上MA4，周K本周站上MA4和MA7且属第一周，按日K站上MA4持续天数从短到长排",
};

export default function ScreenerPage() {
  return <Screener />;
}
