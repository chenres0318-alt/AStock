import { Suspense } from "react";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">加载看盘…</div>}>
      <Dashboard />
    </Suspense>
  );
}
