import type { Metadata } from "next";
import { NetworkView } from "@/components/network/network-view";
import { getDb } from "@/server/db";
import { listBranchSummaries } from "@/server/queries/branches";

export const metadata: Metadata = { title: "Network" };

export default function NetworkPage() {
  const branches = listBranchSummaries(getDb());
  return (
    <div className="h-[calc(100dvh-3.5rem)] lg:h-dvh">
      <h1 className="sr-only">Branch network</h1>
      <NetworkView branches={branches} />
    </div>
  );
}
