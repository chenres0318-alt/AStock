import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getKline } from "@/lib/market";
import type { KlinePeriod } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const period = (searchParams.get("period") ?? "day") as KlinePeriod;
    if (!code) return NextResponse.json({ error: "缺少 code" }, { status: 400 });
    if (!["day", "week", "month"].includes(period)) {
      return NextResponse.json({ error: "period 无效" }, { status: 400 });
    }
    const bars = await getKline(code, period);
    return NextResponse.json({ bars });
  } catch (error) {
    return fail(error);
  }
}
