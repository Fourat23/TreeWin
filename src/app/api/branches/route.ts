import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { listBranchSummaries } from "@/server/queries/branches";

/** Lightweight branch list (command palette, pickers). */
export async function GET() {
  const rows = listBranchSummaries(getDb()).map((b) => ({
    id: b.id,
    code: b.code,
    profile: b.profile,
    status: b.status,
    currentCapitalCents: b.currentCapitalCents,
    hasPendingTicket: b.hasPendingTicket,
  }));
  return NextResponse.json(rows);
}
