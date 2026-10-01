import { NextResponse } from "next/server";
import { listBranchSummaries } from "@/server/queries/branches";
import { getRepository } from "@/server/state";
import { apiWorkspace } from "@/server/state/workspace";

/** Lightweight branch list (command palette, pickers). */
export async function GET(request: Request) {
  const state = await getRepository().load(await apiWorkspace(request));
  const rows = listBranchSummaries(state).map((b) => ({
    id: b.id,
    code: b.code,
    profile: b.profile,
    status: b.status,
    currentCapitalCents: b.currentCapitalCents,
    hasPendingTicket: b.hasPendingTicket,
  }));
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
