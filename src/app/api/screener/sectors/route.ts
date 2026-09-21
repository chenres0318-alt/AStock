import { NextResponse } from "next/server";
import { screenBoards } from "@/lib/screener";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const started = Date.now();
  try {
    const data = await screenBoards();
    return NextResponse.json({ ...data, elapsedMs: Date.now() - started });
  } catch (error) {
    console.error("[screener/sectors]", error);
    const message = error instanceof Error ? error.message : "板块筛选失败";
    return NextResponse.json({ scanned: 0, items: [], error: message, elapsedMs: Date.now() - started });
  }
}
