import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { screenBoards } from "@/lib/screener";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const started = Date.now();
    const data = await screenBoards();
    return NextResponse.json({ ...data, elapsedMs: Date.now() - started });
  } catch (error) {
    console.error("[screener/sectors]", error);
    return fail(error);
  }
}
