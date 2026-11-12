import { Suspense } from "react";
import SectorTrendView from "@/components/SectorTrendView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "板块趋势 · AStock 看盘",
  description: "板块近期趋势：周 K 站上 MA4 开始画红框，周 K 跌破 MA4 收成灰框",
};

export default function SectorPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">加载板块趋势…</div>}>
      <SectorTrendView />
    </Suspense>
  );
}
