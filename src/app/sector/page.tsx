import { Suspense } from "react";
import SectorTrendView from "@/components/SectorTrendView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "板块趋势 · AStock 看盘",
  description: "板块近期趋势捕捉：低点当天拉起并有领涨龙头则画红框，守住低点延伸，回吐、跌破低点或日线同时跌破 MA4 和 MA7 收成灰框",
};

export default function SectorPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">加载板块趋势…</div>}>
      <SectorTrendView />
    </Suspense>
  );
}
