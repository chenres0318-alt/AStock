import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "必须行业和概念都在红框，日K站上MA4和MA7、周K站上MA4和MA7，按红框持续天数从短到长排",
};

export default function ScreenerPage() {
  return <Screener />;
}
