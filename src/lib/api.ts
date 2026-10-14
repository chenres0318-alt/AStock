import { NextResponse } from "next/server";
import { UpstreamError } from "@/lib/http";

export const dynamic = "force-dynamic";

export function fail(error: unknown) {
  const raw = error instanceof Error ? error.message : "服务异常";
  const message = raw === "fetch failed" || raw === "Failed to fetch" ? "行情源暂时连不上" : raw;
  const status = error instanceof UpstreamError ? error.status : 502;
  return NextResponse.json({ error: message }, { status });
}
