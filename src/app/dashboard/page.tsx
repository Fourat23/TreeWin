import type { Metadata } from "next";
import { DashboardActions } from "@/components/dashboard/dashboard-actions";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDashboard } from "@/server/queries/overview";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { state } = await loadPageState();
  const data = getDashboard(state);
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
