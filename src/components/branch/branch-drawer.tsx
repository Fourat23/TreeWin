"use client";

import { withWorkspace } from "@/lib/workspace";
import { useUi } from "@/components/providers/ui-provider";
import { Sheet } from "@/components/ui/sheet";
import { useJson } from "@/lib/use-json";
import type { BranchDetailDTO } from "@/server/queries/dto";
import { BranchDetailView } from "./branch-detail-view";

/** Right drawer on desktop, bottom sheet on mobile — opened by clicking any branch. */
export function BranchDrawer({
  branchId,
  onClose,
}: {
  branchId: string | null;
  onClose: () => void;
}) {
  const { dataVersion, workspace } = useUi();
  const { data, error, loading } = useJson<BranchDetailDTO>(
    branchId ? withWorkspace(`/api/branches/${encodeURIComponent(branchId)}`, workspace) : null,
    dataVersion,
  );
  const title = data ? `Branch ${data.branch.code}` : "Branch";

  return (
    <Sheet
      open={branchId !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={title}
    >
      {error ? (
        <p className="p-6 text-sm text-critical">{error}</p>
      ) : data ? (
        <div className={loading ? "opacity-70 transition-opacity" : undefined}>
          <BranchDetailView detail={data} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-6" aria-busy>
          <div className="h-8 w-32 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-12 w-48 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
        </div>
      )}
    </Sheet>
  );
}
