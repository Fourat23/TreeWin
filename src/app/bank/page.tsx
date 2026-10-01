import type { Metadata } from "next";
import { BankView } from "@/components/bank/bank-view";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { bankFiltersSchema, getBankData } from "@/server/queries/bank";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "BANK" };

export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = bankFiltersSchema.parse(
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
  );
  const { state } = await loadPageState();
  return (
    <PageContainer>
      <PageHeader
        title="BANK"
        description="Capital secured outside the ecosystem — and where every euro came from."
      />
      <BankView data={getBankData(state, filters)} filters={filters} />
    </PageContainer>
  );
}
