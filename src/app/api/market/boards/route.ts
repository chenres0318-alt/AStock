import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getBoards } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getBoards();
    return NextResponse.json(data);
  } catch (error) {
    return fail(error);
  }
}
