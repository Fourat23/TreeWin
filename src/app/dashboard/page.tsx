import type { Metadata } from "next";
import { DashboardActions } from "@/components/dashboard/dashboard-actions";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { getDashboard } from "@/server/queries/overview";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const data = getDashboard(getDb());
  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Secured BANK first, capital at risk second — never mixed."
        actions={data.isEmpty ? null : <DashboardActions />}
      />
      <DashboardView data={data} />
    </PageContainer>
  );
}
