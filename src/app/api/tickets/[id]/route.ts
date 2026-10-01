import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getTicketDetail } from "@/server/queries/tickets";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const detail = getTicketDetail(getDb(), id);
  if (!detail) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json(detail);
}
