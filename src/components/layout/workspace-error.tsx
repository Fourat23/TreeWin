"use client";

import { ShieldAlert } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import type { Workspace } from "@/domain/types";
import { restoreBackupAction } from "@/server/actions/workspace-actions";
import type { BackupInfo } from "@/server/state/repository";

/**
 * Shown when a workspace file fails validation. Nothing is overwritten automatically: the user
 * picks a snapshot to restore (the rejected file is kept aside, never deleted).
 */
export function WorkspaceErrorScreen({
  workspace,
  path,
  problems,
  backups,
}: {
  workspace: Workspace;
  path: string;
  problems: string[];
  backups: BackupInfo[];
}) {
  const { notifyMutation } = useUi();
  const f = useFormat();
  const [pending, startTransition] = useTransition();
  const restore = (id: string) =>
    startTransition(async () => {
      const result = await restoreBackupAction(workspace, id);
      if (!result.ok) toast.error(result.message);
      else {
        toast.success(`Restored ${id}`);
        notifyMutation();
      }
    });
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={`${workspace} workspace file rejected`} description={path} />
      <Card className="flex flex-col gap-4 p-5">
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-critical" aria-hidden />
          The file failed validation, so CELLTREE refuses to use it and will not write over it.
          Restore a snapshot below (the rejected file is moved aside, not deleted) or fix the file
          by hand.
        </p>
        <ul className="list-disc pl-6 font-mono text-xs text-critical">
          {problems.slice(0, 12).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {backups.length === 0 ? (
          <p className="text-sm text-fg-subtle">No snapshot available for this workspace.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {backups.slice(0, 15).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{b.reason || b.id}</span>
                  <span className="text-xs text-fg-subtle">
                    {b.kind} · {b.createdAt ? f.dateTime(b.createdAt) : b.id}
                  </span>
                </span>
                <Button size="sm" disabled={pending} onClick={() => restore(b.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
