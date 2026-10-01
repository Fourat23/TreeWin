import type { Metadata } from "next";
import { NetworkView } from "@/components/network/network-view";
import { listBranchSummaries } from "@/server/queries/branches";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Network" };

export default async function NetworkPage() {
  const { state } = await loadPageState();
  const branches = listBranchSummaries(state);
  return (
    <div className="h-[calc(100dvh-3.5rem-var(--chrome-h))] lg:h-[calc(100dvh-var(--chrome-h))]">
      <h1 className="sr-only">Branch network</h1>
      <NetworkView branches={branches} />
    </div>
  );
}
