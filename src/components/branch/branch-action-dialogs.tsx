"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { parseMoney } from "@/domain/money";
import { PROFILES, type Profile } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PROFILE_LABEL } from "@/lib/labels";
import type { BranchSummaryDTO } from "@/server/queries/dto";
import {
  adjustBranchCapitalAction,
  changeBranchProfileAction,
  setBranchPausedAction,
  transferToBankAction,
  updateBranchNotesAction,
} from "@/server/actions/branch-actions";

type BranchWithNotes = BranchSummaryDTO & { notes: string | null };

export type BranchDialogKind = "adjust" | "bank" | "profile" | "pause" | "notes" | null;

/** Exceptional, journaled operations on a branch. */
export function BranchActionDialogs({
  branch,
  kind,
  onClose,
}: {
  branch: BranchWithNotes;
  kind: BranchDialogKind;
  onClose: () => void;
}) {
  const titles: Record<Exclude<BranchDialogKind, null>, string> = {
    adjust: `Manual capital adjustment — ${branch.code}`,
    bank: `Secure capital to BANK — ${branch.code}`,
    profile: `Change profile — ${branch.code}`,
    pause: branch.status === "PAUSED" ? `Resume ${branch.code}` : `Pause ${branch.code}`,
    notes: `Notes — ${branch.code}`,
  };
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={kind ? titles[kind] : ""}
      size="sm"
    >
      {kind ? <ActionForm key={kind} branch={branch} kind={kind} onDone={onClose} /> : null}
    </Dialog>
  );
}

function ActionForm({
  branch,
  kind,
  onDone,
}: {
  branch: BranchWithNotes;
  kind: Exclude<BranchDialogKind, null>;
  onDone: () => void;
}) {
  const f = useFormat();
  const { notifyMutation } = useUi();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"+" | "-">("-");
  const [reason, setReason] = useState("");
  const [profile, setProfile] = useState<Profile>(
    branch.profile === "HARVEST" ? "BALANCED" : "HARVEST",
  );
  const [applyCap, setApplyCap] = useState(false);
  const [notes, setNotes] = useState(branch.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      let result;
      if (kind === "adjust" || kind === "bank") {
        const cents = parseMoney(amount);
        if (cents === null || cents <= 0) {
          setError("Enter a positive amount");
          return;
        }
        result =
          kind === "adjust"
            ? await adjustBranchCapitalAction({
                branchId: branch.id,
                deltaCents: direction === "+" ? cents : -cents,
                reason,
              })
            : await transferToBankAction({ branchId: branch.id, amountCents: cents, reason });
      } else if (kind === "profile") {
        result = await changeBranchProfileAction({
          branchId: branch.id,
          profile,
          reason,
          applyProfileCap: applyCap,
        });
      } else if (kind === "notes") {
        result = await updateBranchNotesAction({ branchId: branch.id, notes });
      } else {
        result = await setBranchPausedAction({
          branchId: branch.id,
          paused: branch.status !== "PAUSED",
          reason: reason || undefined,
        });
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(kind === "notes" ? "Notes saved" : "Saved and journaled");
      notifyMutation();
      onDone();
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      {kind === "adjust" ? (
        <>
          <p className="text-sm text-fg-muted">
            For data-entry errors or Winamax corrections only. Creates a MANUAL_ADJUSTMENT event.
            Current capital:{" "}
            <span className="num text-fg">{f.money(branch.currentCapitalCents)}</span>.
          </p>
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <Select
              aria-label="Direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "+" | "-")}
            >
              <option value="-">− remove</option>
              <option value="+">+ add</option>
            </Select>
            <AmountInput
              aria-label="Amount"
              suffix="€"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </>
      ) : null}
      {kind === "bank" ? (
        <>
          <p className="text-sm text-fg-muted">
            Moves money from {branch.code} to the BANK. This is one-way: BANK money never returns to
            the branches.
          </p>
          <Field label="Amount">
            {(p) => (
              <AmountInput
                {...p}
                suffix="€"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
        </>
      ) : null}
      {kind === "profile" ? (
        <>
          <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-fg">
            Profiles are fixed at birth. Changing one is exceptional and will be journaled.
          </p>
          <Field label="New profile">
            {(p) => (
              <Select
                {...p}
                value={profile}
                onChange={(e) => setProfile(e.target.value as Profile)}
              >
                {PROFILES.filter((x) => x !== branch.profile).map((x) => (
                  <option key={x} value={x}>
                    {PROFILE_LABEL[x]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              className="size-4 accent-[var(--fg)]"
              checked={applyCap}
              onChange={(e) => setApplyCap(e.target.checked)}
            />
            Also apply the new profile&apos;s cap
          </label>
        </>
      ) : null}
      {kind === "pause" ? (
        <p className="text-sm text-fg-muted">
          {branch.status === "PAUSED"
            ? "The branch will be able to open rounds again."
            : "A paused branch keeps its capital but cannot open new rounds. No-bet days are never a problem — pausing is optional."}
        </p>
      ) : null}
      {kind === "notes" ? (
        <Field label="Notes">
          {(p) => (
            <Textarea {...p} rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </Field>
      ) : (
        <Field label={kind === "pause" ? "Reason (optional)" : "Reason (journaled)"}>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
      {error ? <p className="text-sm text-critical">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </form>
  );
}
