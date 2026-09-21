import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getSearch } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const items = await getSearch(q);
    return NextResponse.json({ items });
  } catch (error) {
    return fail(error);
  }
}
