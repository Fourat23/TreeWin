"use client";

import { History, Undo2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { undoLastChangeAction } from "@/server/actions/workspace-actions";

/** "Last change: … [Undo]" — restores the snapshot taken right before the last change. */
export function UndoBar() {
  const { workspace, lastChange, notifyMutation } = useUi();
  const f = useFormat();
  const [pending, startTransition] = useTransition();
  if (!lastChange) return null;

  const undo = () => {
    const later =
      lastChange.laterChanges > 0
        ? `\n\n${lastChange.laterChanges} later change(s) will be reverted as well.`
        : "";
    if (
      !window.confirm(
        `Undo “${lastChange.label}”?${later}\n\nThe current state is snapshotted first, so this can be undone too.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await undoLastChangeAction(workspace);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Undone: ${result.data}`);
      notifyMutation();
    });
  };

  return (
    <div
      className="flex min-w-0 items-center gap-2 text-[12px] text-fg-muted"
      data-testid="undo-bar"
    >
      <History className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      <span className="min-w-0 truncate">
        <span className="text-fg-subtle">Last change:</span>{" "}
        <span className="text-fg">{lastChange.label}</span>
        <span className="hidden text-fg-subtle sm:inline"> · {f.dateTime(lastChange.at)}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={undo}
        disabled={pending}
        className="h-6 px-2 text-[12px]"
      >
        <Undo2 /> Undo
      </Button>
    </div>
  );
}
