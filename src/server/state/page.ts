import "server-only";
import type { Workspace } from "@/domain/types";
import { getRepository } from ".";
import type { WorkspaceState } from "./schema";
import { requestWorkspace } from "./workspace";

/** Workspace selected by this request and its (immutable) state. */
export async function loadPageState(): Promise<{ workspace: Workspace; state: WorkspaceState }> {
  const workspace = await requestWorkspace();
  return { workspace, state: await getRepository().load(workspace) };
}
