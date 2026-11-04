import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { listAllIndustryBoards, listSelectableBoards, listTonghuashunConcepts } from "@/lib/boards";
import { getSectors } from "@/lib/market";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope");
    const items =
      scope === "concept"
        ? await listTonghuashunConcepts()
        : scope === "industry"
          ? await listAllIndustryBoards()
          : scope === "all"
            ? await listSelectableBoards()
            : await getSectors();
    return NextResponse.json({ items });
  } catch (error) {
    return fail(error);
  }
}
