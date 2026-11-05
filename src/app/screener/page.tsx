import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "必须行业和概念都在红框且指数、个股日K站上MA4；周K、上叉、月K加分，条件越多、同时成立越短越靠前",
};

export default function ScreenerPage() {
  return <Screener />;
}
