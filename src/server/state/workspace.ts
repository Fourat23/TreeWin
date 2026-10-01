import "server-only";
import { cookies } from "next/headers";
import { WORKSPACES, type Workspace } from "@/domain/types";
import { WORKSPACE_COOKIE } from "@/lib/workspace";

export function parseWorkspace(value: string | null | undefined): Workspace | null {
  return (WORKSPACES as readonly string[]).includes(value ?? "") ? (value as Workspace) : null;
}

/**
 * Workspace selected by this request (cookie). Only a UI preference: every query and action
 * receives the workspace explicitly — there is no global "current workspace".
 */
export async function requestWorkspace(): Promise<Workspace> {
  return parseWorkspace((await cookies()).get(WORKSPACE_COOKIE)?.value) ?? "REAL";
}

/** Workspace of an API request: explicit `?ws=` parameter first, then the cookie. */
export async function apiWorkspace(request: Request): Promise<Workspace> {
  return parseWorkspace(new URL(request.url).searchParams.get("ws")) ?? (await requestWorkspace());
}
