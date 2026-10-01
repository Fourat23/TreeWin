import type { Workspace } from "@/domain/types";

/** Cookie remembering which workspace the UI shows (REAL by default). */
export const WORKSPACE_COOKIE = "celltree-workspace";

/** Local API URL scoped to a workspace (every read names its workspace explicitly). */
export function withWorkspace(url: string, workspace: Workspace): string {
  return `${url}${url.includes("?") ? "&" : "?"}ws=${workspace}`;
}
