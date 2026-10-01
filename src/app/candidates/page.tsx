import type { Metadata } from "next";
import { CandidatesView } from "@/components/candidates/candidates-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { getCandidateStats } from "@/server/queries/analytics";
import { toCandidateDTO } from "@/server/queries/mappers";
import { listCandidates } from "@/server/services/candidate-service";
import { getSettings } from "@/server/services/settings-service";

export const metadata: Metadata = { title: "Candidates" };

export default function CandidatesPage() {
  const db = getDb();
  const stats = getCandidateStats(db, getSettings(db).analytics.minSampleSize);
  return (
    <PageContainer>
      <PageHeader
        title="Candidates"
        description="Shadow portfolio: matches analysed but not played — statistics without staking."
      />
      <CandidatesView candidates={listCandidates(db).map(toCandidateDTO)} stats={stats} />
    </PageContainer>
  );
}
