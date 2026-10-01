import { getDb } from "@/server/db";
import { bankCsv, branchesCsv, ticketsCsv } from "@/server/services/backup-service";

const EXPORTS = { tickets: ticketsCsv, branches: branchesCsv, bank: bankCsv } as const;

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!(kind in EXPORTS)) return new Response("Unknown export", { status: 404 });
  const csv = EXPORTS[kind as keyof typeof EXPORTS](getDb());
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="celltree-${kind}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
