import { Suspense } from "react";
import SectorTrendView from "@/components/SectorTrendView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "板块趋势 · AStock 看盘",
  description: "板块近期趋势：日K MA7>MA10 开始画红框，指数低于日线 MA7 收成灰框",
};

export default function SectorPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">加载板块趋势…</div>}>
      <SectorTrendView />
    </Suspense>
  );
}
