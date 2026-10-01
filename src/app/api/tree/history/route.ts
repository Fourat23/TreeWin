import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getTreeHistory } from "@/server/queries/branches";

export async function GET() {
  return NextResponse.json(getTreeHistory(getDb()));
}
