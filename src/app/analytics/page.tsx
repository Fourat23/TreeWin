import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { getAnalytics } from "@/server/queries/analytics";
import { getSettings } from "@/server/services/settings-service";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  const db = getDb();
  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description="Profiles and tickets, with medians and confidence intervals — no conclusions from tiny samples."
      />
      <AnalyticsView data={getAnalytics(db, getSettings(db))} />
    </PageContainer>
  );
}
