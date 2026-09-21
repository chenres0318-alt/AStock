import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getSectors } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getSectors();
    return NextResponse.json({ items });
  } catch (error) {
    return fail(error);
  }
}
