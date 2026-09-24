import { NextResponse } from "next/server";
import { screenStocks } from "@/lib/screener";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const started = Date.now();
  try {
    const data = await screenStocks();
    return NextResponse.json({ ...data, elapsedMs: Date.now() - started });
  } catch (error) {
    console.error("[screener/stocks]", error);
    const message = error instanceof Error ? error.message : "选股失败";
    return NextResponse.json({ scanned: 0, universe: 0, items: [], error: message, elapsedMs: Date.now() - started });
  }
}
