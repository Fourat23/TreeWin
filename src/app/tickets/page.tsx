import type { Metadata } from "next";
import { NewRoundButton } from "@/components/tickets/new-round-button";
import { TicketsJournal } from "@/components/tickets/tickets-journal";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { listTickets, ticketFiltersSchema } from "@/server/queries/tickets";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const filters = ticketFiltersSchema.parse(flat);
  const data = listTickets(getDb(), filters);
  return (
    <PageContainer>
      <PageHeader
        title="Tickets journal"
        description="Every round of every branch. One ticket = one single match on Winamax."
        actions={<NewRoundButton />}
      />
      <TicketsJournal data={data} filters={filters} />
    </PageContainer>
  );
}
