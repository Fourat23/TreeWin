import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getAnalytics } from "@/server/queries/analytics";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const { state } = await loadPageState();
  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description="Profiles and tickets, with medians and confidence intervals — no conclusions from tiny samples."
      />
      <AnalyticsView data={getAnalytics(state)} />
    </PageContainer>
  );
}
