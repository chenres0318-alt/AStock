import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getSectorTrend, listBoardsInTrend } from "@/lib/sectorTrendData";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("list") === "active") {
      const codes = await listBoardsInTrend();
      return NextResponse.json({ codes });
    }
    const code = params.get("code")?.trim() ?? "";
    if (!code) return NextResponse.json({ error: "缺少板块代码" }, { status: 400 });
    const report = await getSectorTrend(code);
    return NextResponse.json(report);
  } catch (error) {
    return fail(error);
  }
}
