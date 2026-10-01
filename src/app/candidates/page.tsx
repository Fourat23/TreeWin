import type { Metadata } from "next";
import { CandidatesView } from "@/components/candidates/candidates-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getCandidateStats } from "@/server/queries/analytics";
import { toCandidateDTO } from "@/server/queries/mappers";
import { listCandidates } from "@/server/services/candidate-service";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Candidates" };

export default async function CandidatesPage() {
  const { state } = await loadPageState();
  const stats = getCandidateStats(state, state.settings.analytics.minSampleSize);
  return (
    <PageContainer>
      <PageHeader
        title="Candidates"
        description="Shadow portfolio: matches analysed but not played — statistics without staking."
      />
      <CandidatesView candidates={listCandidates(state).map(toCandidateDTO)} stats={stats} />
    </PageContainer>
  );
}
