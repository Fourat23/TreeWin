import { bankCsv, branchesCsv, ticketsCsv } from "@/server/services/backup-service";
import { getRepository } from "@/server/state";
import { apiWorkspace } from "@/server/state/workspace";

const EXPORTS = { tickets: ticketsCsv, branches: branchesCsv, bank: bankCsv } as const;

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!(kind in EXPORTS)) return new Response("Unknown export", { status: 404 });
  const workspace = await apiWorkspace(request);
  const csv = EXPORTS[kind as keyof typeof EXPORTS](await getRepository().load(workspace));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="celltree-${workspace.toLowerCase()}-${kind}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
