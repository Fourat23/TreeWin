import type { Metadata } from "next";
import { TreeView } from "@/components/tree/tree-view";
import { listBranchSummaries } from "@/server/queries/branches";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Tree" };

export default async function TreePage() {
  const { state } = await loadPageState();
  const branches = listBranchSummaries(state);
  return (
    <div className="h-[calc(100dvh-3.5rem-var(--chrome-h))] lg:h-[calc(100dvh-var(--chrome-h))]">
      <h1 className="sr-only">Branch tree</h1>
      <TreeView branches={branches} />
    </div>
  );
}
