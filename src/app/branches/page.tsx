import type { Metadata } from "next";
import { BranchesTable } from "@/components/branch/branches-table";
import { CreateBranchButton } from "@/components/branch/create-branch-button";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { listBranchSummaries } from "@/server/queries/branches";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Branches" };

export default async function BranchesPage() {
  const { state } = await loadPageState();
  return (
    <PageContainer>
      <PageHeader
        title="Branches"
        description="Every bankroll ever created — dead branches stay here forever."
        actions={<CreateBranchButton />}
      />
      <BranchesTable branches={listBranchSummaries(state)} />
    </PageContainer>
  );
}
