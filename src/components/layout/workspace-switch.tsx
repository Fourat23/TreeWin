"use client";

import { FlaskConical, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { useUi } from "@/components/providers/ui-provider";
import { WORKSPACES, type Workspace } from "@/domain/types";
import { cn } from "@/lib/cn";
import { setWorkspacePreferenceAction } from "@/server/actions/workspace-actions";

/**
 * Persistent REAL / DEMO switch. Switching only changes which workspace the UI displays
 * (a cookie preference): it never reads into or writes to the other workspace.
 */
export function WorkspaceSwitch({ className }: { className?: string }) {
  const { workspace } = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const select = (next: Workspace) => {
    if (next === workspace || pending) return;
    startTransition(async () => {
      const result = await setWorkspacePreferenceAction(next);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      // Detail pages (a ticket, a branch) belong to one workspace: go back to the section.
      const section = pathname.split("/")[1] || "dashboard";
      router.push(`/${section}`);
      router.refresh();
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="Workspace"
      className={cn(
        "grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      {WORKSPACES.map((ws) => {
        const active = ws === workspace;
        const Icon = ws === "REAL" ? ShieldCheck : FlaskConical;
        return (
          <button
            key={ws}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={pending}
            onClick={() => select(ws)}
            data-testid={`workspace-${ws.toLowerCase()}`}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold tracking-wide transition-colors",
              active
                ? ws === "REAL"
                  ? "bg-good/15 text-good shadow-sm"
                  : "bg-warning/20 text-warning shadow-sm"
                : "text-fg-subtle hover:text-fg",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {ws}
          </button>
        );
      })}
    </div>
  );
}

/** Small persistent badge naming the data currently displayed. */
export function WorkspaceBadge({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { workspace } = useUi();
  return workspace === "REAL" ? (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-good/30 bg-good/10 px-2 text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-good",
        className,
      )}
      data-testid="workspace-badge"
    >
      <ShieldCheck className="size-3.5" aria-hidden /> {compact ? "REAL" : "REAL DATA"}
    </span>
  ) : (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/15 px-2 text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-warning",
        className,
      )}
      data-testid="workspace-badge"
    >
      <FlaskConical className="size-3.5" aria-hidden /> {compact ? "DEMO" : "DEMO DATA"}
    </span>
  );
}
