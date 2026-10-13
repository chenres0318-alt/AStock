import { Suspense } from "react";
import SectorTrendView from "@/components/SectorTrendView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "板块趋势 · AStock 看盘",
  description: "板块近期趋势捕捉：局部低点出发、不破位、个股同步、有龙头才画框",
};

export default function SectorPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">加载板块趋势…</div>}>
      <SectorTrendView />
    </Suspense>
  );
}
