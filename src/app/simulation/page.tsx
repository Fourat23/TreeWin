import type { Metadata } from "next";
import { SimulationView } from "@/components/simulation/simulation-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Simulation" };

export default async function SimulationPage() {
  const { state } = await loadPageState();
  return (
    <PageContainer>
      <PageHeader
        title="Monte Carlo simulation"
        description="Strictly local and hypothetical: no data is written and nothing is ever bet."
      />
      <SimulationView settings={state.settings} />
    </PageContainer>
  );
}
