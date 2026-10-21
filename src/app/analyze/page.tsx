import { Suspense } from "react";
import CompanyAnalysisView from "@/components/CompanyAnalysisView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "公司分析 · AStock 看盘",
  description: "输入公司名称，看基本面、估值、最近利好利空、减持、限售、定增和经营风险",
};

export default function AnalyzePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">加载公司分析…</div>}>
      <CompanyAnalysisView />
    </Suspense>
  );
}
