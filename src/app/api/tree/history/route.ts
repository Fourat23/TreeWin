import { NextResponse } from "next/server";
import { getTreeHistory } from "@/server/queries/branches";
import { getRepository } from "@/server/state";
import { apiWorkspace } from "@/server/state/workspace";

export async function GET(request: Request) {
  const state = await getRepository().load(await apiWorkspace(request));
  return NextResponse.json(getTreeHistory(state), { headers: { "Cache-Control": "no-store" } });
}
