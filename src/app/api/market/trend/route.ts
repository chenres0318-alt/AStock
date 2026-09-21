import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getTrend } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    if (!code) return NextResponse.json({ error: "缺少 code" }, { status: 400 });
    const data = await getTrend(code);
    return NextResponse.json(data);
  } catch (error) {
    return fail(error);
  }
}
