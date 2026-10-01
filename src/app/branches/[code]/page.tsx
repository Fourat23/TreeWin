import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BranchDetailView } from "@/components/branch/branch-detail-view";
import { PageContainer } from "@/components/ui/misc";
import { getBranchDetail } from "@/server/queries/branches";
import { loadPageState } from "@/server/state/page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return { title: `Branch ${decodeURIComponent(code)}` };
}

export default async function BranchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { state } = await loadPageState();
  const detail = getBranchDetail(state, decodeURIComponent(code));
  if (!detail) notFound();
  return (
    <PageContainer className="max-w-4xl">
      <Link
        href="/branches"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Branches
      </Link>
      <h1 className="sr-only">Branch {detail.branch.code}</h1>
      <BranchDetailView detail={detail} variant="page" />
    </PageContainer>
  );
}
