import type { Metadata } from "next";
import { TreeView } from "@/components/tree/tree-view";
import { getDb } from "@/server/db";
import { listBranchSummaries } from "@/server/queries/branches";

export const metadata: Metadata = { title: "Tree" };

export default function TreePage() {
  const branches = listBranchSummaries(getDb());
  return (
    <div className="h-[calc(100dvh-3.5rem)] lg:h-dvh">
      <h1 className="sr-only">Branch tree</h1>
      <TreeView branches={branches} />
    </div>
  );
}
