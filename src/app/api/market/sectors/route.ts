import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { listAllIndustryBoards } from "@/lib/boards";
import { getSectors } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope");
    const items = scope === "all" ? await listAllIndustryBoards() : await getSectors();
    return NextResponse.json({ items });
  } catch (error) {
    return fail(error);
  }
}
