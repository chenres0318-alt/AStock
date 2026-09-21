import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getOverview } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const codes = (searchParams.get("codes") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const data = await getOverview(codes);
    return NextResponse.json(data);
  } catch (error) {
    return fail(error);
  }
}
