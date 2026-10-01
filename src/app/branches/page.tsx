import type { Metadata } from "next";
import { BranchesTable } from "@/components/branch/branches-table";
import { CreateBranchButton } from "@/components/branch/create-branch-button";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { listBranchSummaries } from "@/server/queries/branches";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Branches"
        description="Every bankroll ever created — dead branches stay here forever."
        actions={<CreateBranchButton />}
      />
      <BranchesTable branches={listBranchSummaries(getDb())} />
    </PageContainer>
  );
}
