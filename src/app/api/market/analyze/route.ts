import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { getCompanyAnalysis } from "@/lib/companyAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const report = await getCompanyAnalysis(q);
    return NextResponse.json(report);
  } catch (error) {
    return fail(error);
  }
}
