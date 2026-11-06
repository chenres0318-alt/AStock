import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "必须日K、周K、月K站上MA4，行业和概念都在红框且指数站上MA4；按个股日K站上MA4天数从短到长",
};

export default function ScreenerPage() {
  return <Screener />;
}
