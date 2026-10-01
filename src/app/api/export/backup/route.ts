import { getDb } from "@/server/db";
import { exportBackup } from "@/server/services/backup-service";

export async function GET() {
  const backup = exportBackup(getDb());
  const stamp = backup.exportedAt.replace(/[:.]/g, "-");
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="celltree-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
