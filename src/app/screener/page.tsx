import Screener from "@/components/Screener";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "选股 · AStock 看盘",
  description: "红框行业且指数站上MA4，成分股按上叉/周K/月K及这些条件的持续天数从短到长",
};

export default function ScreenerPage() {
  return <Screener />;
}
