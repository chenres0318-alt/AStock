import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getRank } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") ?? "up";
    if (kind !== "up" && kind !== "down" && kind !== "amount") {
      return NextResponse.json({ error: "kind 无效" }, { status: 400 });
    }
    const items = await getRank(kind);
    return NextResponse.json({ items });
  } catch (error) {
    return fail(error);
  }
}
