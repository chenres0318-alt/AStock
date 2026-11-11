import { Suspense } from "react";
import SectorTrendView from "@/components/SectorTrendView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "板块趋势 · AStock 看盘",
  description: "板块红色趋势：日K和周K都站上MA4和MA7为开始，日K或周K同时跌破MA4和MA7为结束并改成灰框",
};

export default function SectorPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">加载板块趋势…</div>}>
      <SectorTrendView />
    </Suspense>
  );
}
