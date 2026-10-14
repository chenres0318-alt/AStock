import { NextResponse } from "next/server";
import { UpstreamError } from "@/lib/http";

export const dynamic = "force-dynamic";

export function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "服务异常";
  const status = error instanceof UpstreamError ? error.status : 502;
  return NextResponse.json({ error: message }, { status });
}
