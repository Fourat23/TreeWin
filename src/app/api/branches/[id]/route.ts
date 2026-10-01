import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getBranchDetail } from "@/server/queries/branches";
import { getSettings } from "@/server/services/settings-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDb();
  const detail = getBranchDetail(db, decodeURIComponent(id), getSettings(db));
  if (!detail) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  return NextResponse.json(detail);
}
