import { NextResponse } from "next/server";
import { getBranchDetail } from "@/server/queries/branches";
import { getRepository } from "@/server/state";
import { apiWorkspace } from "@/server/state/workspace";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await getRepository().load(await apiWorkspace(request));
  const detail = getBranchDetail(state, decodeURIComponent(id));
  if (!detail) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
