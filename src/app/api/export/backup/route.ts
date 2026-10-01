import { exportWorkspace } from "@/server/services/backup-service";
import { getRepository } from "@/server/state";
import { apiWorkspace } from "@/server/state/workspace";

/** Download the whole workspace as a JSON export (carries its workspace identity). */
export async function GET(request: Request) {
  const workspace = await apiWorkspace(request);
  const file = exportWorkspace(await getRepository().load(workspace));
  const stamp = new Date(file.createdAt).toISOString().replace(/[:.]/g, "-");
  return new Response(`${JSON.stringify(file, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="celltree-${workspace.toLowerCase()}-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
