"use client";

import { AlertTriangle, Archive, Camera, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  applyCorrectionAction,
  previewCorrectionAction,
} from "@/server/actions/correction-actions";
import type {
  CorrectionImpact,
  CorrectionTarget,
  DeleteMode,
} from "@/server/services/correction-service";

const TITLES: Record<CorrectionTarget["kind"], string> = {
  REOPEN_TICKET: "Reopen ticket",
  DELETE_TICKET: "Delete ticket",
  DELETE_FROM_EVENT: "Delete from this point",
  DELETE_BRANCH: "Delete root branch",
};

/**
 * The generic destructive workflow: impact preview (dry run) → automatic snapshot →
 * explicit confirmation. Archive is the default; a permanent purge needs a typed confirmation.
 */
export function CorrectionDialog({
  target,
  onClose,
  onDone,
}: {
  target: CorrectionTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  return target ? (
    <CorrectionDialogBody
      key={JSON.stringify(target)}
      target={target}
      onClose={onClose}
      onDone={onDone}
    />
  ) : null;
}

function CorrectionDialogBody({
  target,
  onClose,
  onDone,
}: {
  target: CorrectionTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { workspace } = useUi();
  const f = useFormat();
  const [impact, setImpact] = useState<CorrectionImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DeleteMode>("ARCHIVE");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const reopen = target.kind === "REOPEN_TICKET";

  useEffect(() => {
    let cancelled = false;
    void previewCorrectionAction(workspace, target).then((result) => {
      if (cancelled) return;
      if (result.ok) setImpact(result.data);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, target]);

  const purge = mode === "PURGE" && !reopen;
  const confirmed =
    !purge ||
    (impact !== null &&
      (confirmation.trim() === impact.confirmationText || confirmation.trim() === "DELETE"));

  async function submit() {
    setBusy(true);
    const result = await applyCorrectionAction(workspace, {
      target,
      mode: reopen ? "ARCHIVE" : mode,
      reason: reason.trim() || undefined,
      confirmation: purge ? confirmation.trim() : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(result.data.label, {
      description: "A snapshot was taken first — use Undo in the top bar to revert.",
    });
    onDone();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={TITLES[target.kind]}
      description={impact?.label ?? "Computing the impact…"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={reopen ? "primary" : "danger"}
            disabled={!impact || !confirmed || busy}
            onClick={submit}
            data-testid="confirm-correction"
          >
            {reopen ? (
              "Reopen ticket"
            ) : purge ? (
              <>
                <Trash2 /> Delete permanently
              </>
            ) : (
              <>
                <Archive /> Archive &amp; delete
              </>
            )}
          </Button>
        </>
      }
    >
      {error ? (
        <p
          className="rounded-lg border border-critical/30 bg-critical/10 p-3 text-sm text-critical"
          role="alert"
        >
          {error}
        </p>
      ) : !impact ? (
        <p className="text-sm text-fg-subtle">Dry run in progress…</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p className="flex items-start gap-2 text-fg-muted">
            <Camera className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
            An automatic snapshot of the {workspace} workspace is taken before anything changes.
            Money is never edited in place: the history from this point is removed and the branch is
            rebuilt from what remains.
          </p>

          {impact.branch ? (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-2/60 p-3">
              <div>
                <p className="text-xs text-fg-subtle">{impact.branch.code} capital</p>
                <p className="font-mono tabular-nums">
                  {f.money(impact.branch.capitalBeforeCents)} →{" "}
                  <strong>{f.money(impact.branch.capitalAfterCents)}</strong>
                </p>
              </div>
              <div>
                <p className="text-xs text-fg-subtle">Status</p>
                <p>
                  {impact.branch.statusBefore} → <strong>{impact.branch.statusAfter}</strong>
                </p>
              </div>
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Stat label="Tickets removed" value={impact.removedTickets.length} />
            <Stat label="Tickets reopened" value={impact.reopenedTickets.length} />
            <Stat label="Branches removed" value={impact.removedBranches.length} />
            <Stat label="Events removed" value={impact.removedEvents} />
            <Stat label="BANK removed" value={f.money(impact.bank.amountCents)} />
            <Stat
              label="Active capital"
              value={f.money(impact.activeCapitalDeltaCents, { signed: true })}
            />
          </dl>

          {impact.removedBranches.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs text-fg-subtle">Branches removed (whole subtrees)</p>
              <div className="flex flex-wrap gap-1.5">
                {impact.removedBranches.map((b) => (
                  <Badge key={b.id} tone={b.status === "DEAD" ? "dead" : "neutral"}>
                    {b.code} · {f.money(b.capitalCents)}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {impact.removedTickets.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs text-fg-subtle">Tickets removed</p>
              <ul className="max-h-36 overflow-y-auto rounded-lg border border-border text-[13px]">
                {impact.removedTickets.map((t) => (
                  <li
                    key={t.id}
                    className="flex justify-between gap-3 border-b border-border px-3 py-1.5 last:border-0"
                  >
                    <span className="truncate">
                      {t.branchCode}·{f.round(t.roundNumber)} — {t.eventName}
                    </span>
                    <span className="text-fg-subtle">{t.cancelled ? "CANCELLED" : t.result}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {impact.warnings.map((w) => (
            <p
              key={w}
              className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-[13px] text-warning"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {w}
            </p>
          ))}

          {!reopen ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-medium text-fg-muted">Deletion mode</legend>
              {(
                [
                  [
                    "ARCHIVE",
                    "Archive (default)",
                    "Removed from the ledger but kept in the file’s archive section.",
                  ],
                  [
                    "PURGE",
                    "Delete permanently",
                    "Gone from the current state (still in earlier snapshots).",
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2",
                    mode === value ? "border-border-strong bg-surface-2" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="delete-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-fg">{label}</span>
                    <span className="block text-xs text-fg-subtle">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <Field label="Reason (journaled)">
            {(props) => (
              <Textarea
                {...props}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Entered LOST instead of WON"
              />
            )}
          </Field>

          {purge ? (
            <Field
              label={
                <>
                  Type <strong className="font-mono text-fg">{impact.confirmationText}</strong> or{" "}
                  <strong className="font-mono text-fg">DELETE</strong> to confirm
                </>
              }
            >
              {(props) => (
                <Input
                  {...props}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                  data-testid="purge-confirmation"
                />
              )}
            </Field>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="font-mono text-[13px] tabular-nums">{value}</dd>
    </div>
  );
}
