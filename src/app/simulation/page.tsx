import type { Metadata } from "next";
import { SimulationView } from "@/components/simulation/simulation-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getDb } from "@/server/db";
import { getSettings } from "@/server/services/settings-service";

export const metadata: Metadata = { title: "Simulation" };

export default function SimulationPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Monte Carlo simulation"
        description="Strictly local and hypothetical: no data is written and nothing is ever bet."
      />
      <SimulationView settings={getSettings(getDb())} />
    </PageContainer>
  );
}
