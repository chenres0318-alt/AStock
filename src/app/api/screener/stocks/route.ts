import { NextResponse } from "next/server";
import { screenStocks } from "@/lib/screener";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get("boards") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!codes.length) {
    return NextResponse.json({ error: "缺少 boards" }, { status: 400 });
  }
  const started = Date.now();
  try {
    const data = await screenStocks(codes);
    return NextResponse.json({ ...data, elapsedMs: Date.now() - started });
  } catch (error) {
    console.error("[screener/stocks]", error);
    const message = error instanceof Error ? error.message : "选股失败";
    return NextResponse.json({ scanned: 0, items: [], error: message, elapsedMs: Date.now() - started });
  }
}
