import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { scanned: 0, items: [], error: "板块筛选已下线，请直接调用 /api/screener/stocks" },
    { status: 410 },
  );
}
