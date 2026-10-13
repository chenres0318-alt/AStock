import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getSectorTrend } from "@/lib/sectorTrendData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
    if (!code) return NextResponse.json({ error: "缺少板块代码" }, { status: 400 });
    const report = await getSectorTrend(code);
    return NextResponse.json(report);
  } catch (error) {
    return fail(error);
  }
}
