import QuotesBoard from "@/components/QuotesBoard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "行情 · AStock 看盘",
  description: "纳斯达克、标普、沪深300、科创创业板、黄金、红利、银行、石油、日经的日周月K线",
};

export default function QuotesPage() {
  return <QuotesBoard />;
}
