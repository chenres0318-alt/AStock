import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "必须行业和概念都在红框，日K站上MA4和MA7且当天MA4上叉MA7，周K和月K都是首次站上MA4",
};

export default function ScreenerPage() {
  return <Screener />;
}
