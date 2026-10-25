import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { evaluateHoldings } from "@/lib/holdingStatus";
import type { HoldingItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

function readItems(body: unknown): HoldingItem[] {
  if (!body || typeof body !== "object" || !("items" in body)) return [];
  const items = (body as { items: unknown }).items;
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const rows: HoldingItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<HoldingItem>;
    if (typeof row.code !== "string" || typeof row.name !== "string") continue;
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    rows.push({
      code: row.code,
      name: row.name,
      sector: typeof row.sector === "string" ? row.sector : null,
      sectorCode: typeof row.sectorCode === "string" ? row.sectorCode : null,
    });
    if (rows.length >= 30) break;
  }
  return rows;
}

export async function POST(request: Request) {
  try {
    const items = readItems(await request.json().catch(() => null));
    const statuses = await evaluateHoldings(items);
    return NextResponse.json({ items: statuses });
  } catch (error) {
    return fail(error);
  }
}
