import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LineageView } from "@/components/branch/lineage-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { getLineage } from "@/server/queries/branches";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return { title: `Lineage ${decodeURIComponent(code)}` };
}

export default async function LineagePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lineage = getLineage(getDb(), decodeURIComponent(code));
  if (!lineage) notFound();
  return (
    <PageContainer className="max-w-5xl">
      <Link
        href={`/branches/${encodeURIComponent(lineage.branch.code)}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Branch {lineage.branch.code}
      </Link>
      <PageHeader
        title={`Lineage of ${lineage.branch.code}`}
        description="Ancestors, the branch itself and every descendant it produced."
      />
      <LineageView lineage={lineage} />
    </PageContainer>
  );
}
