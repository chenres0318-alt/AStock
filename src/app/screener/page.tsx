import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "必须属于行业或概念红框，日K、周K都站上MA4和MA7，持续时间越短越靠前",
};

export default function ScreenerPage() {
  return <Screener />;
}
