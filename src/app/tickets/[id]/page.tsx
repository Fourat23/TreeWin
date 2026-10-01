import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketDetailView } from "@/components/tickets/ticket-detail-view";
import { PageContainer } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { getTicketDetail } from "@/server/queries/tickets";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getTicketDetail(getDb(), id);
  if (!detail) notFound();
  return (
    <PageContainer>
      <Link
        href="/tickets"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Tickets journal
      </Link>
      <h1 className="mb-5 text-xl font-semibold tracking-tight">
        Ticket {detail.branch.code} · round {detail.bet.roundNumber}
      </h1>
      <TicketDetailView detail={detail} />
    </PageContainer>
  );
}
