import "server-only";
import { revalidatePath } from "next/cache";
import type { Workspace } from "@/domain/types";
import { DomainError } from "../services/errors";
import type { OpContext } from "../services/internal";
import { getRepository } from "../state";
import type { WorkspaceState } from "../state/schema";
import { parseWorkspace } from "../state/workspace";
import { runAction, type ActionResult } from "./result";

/**
 * Every action names its workspace explicitly (there is no global "current workspace"):
 * the client passes the workspace it is displaying, and it is validated here.
 */
export function requireWorkspace(value: unknown): Workspace {
  const workspace = parseWorkspace(typeof value === "string" ? value : null);
  if (!workspace) throw new DomainError("VALIDATION", "Unknown workspace");
  return workspace;
}

export function refreshAll(): void {
  revalidatePath("/", "layout");
}

/**
 * Apply a state operation atomically (load → apply on a copy → validate → snapshot of the
 * previous state → atomic write). Every mutation is labelled: the label names the snapshot,
 * becomes the Undo target ("Last change") and enters the workspace change log.
 */
export function mutateAction<T>(
  workspace: unknown,
  fn: (state: WorkspaceState, ctx: OpContext) => T,
  label: string | ((result: T) => string),
): Promise<ActionResult<T>> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    const result = await getRepository().mutate(ws, fn, { label });
    refreshAll();
    return result;
  });
}

/** Read-only access to a workspace (dry runs, pickers). */
export function readAction<T>(
  workspace: unknown,
  fn: (state: WorkspaceState, ws: Workspace) => T,
): Promise<ActionResult<T>> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    return fn(await getRepository().load(ws), ws);
  });
}
