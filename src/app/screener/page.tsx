import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "必须属于行业或概念红框，日K、周K都站上MA4和MA7；行业和概念都过更好，再按持续时间从短到长",
};

export default function ScreenerPage() {
  return <Screener />;
}
