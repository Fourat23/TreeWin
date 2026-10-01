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
import { Field, Textarea } from "@/components/ui/field";
import { PROFILE_COLOR_VAR, PROFILE_DESCRIPTION, PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { createRootBranchAction } from "@/server/actions/branch-actions";

export function CreateBranchDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create root branch"
      description="A root brings external capital into the ecosystem. BANK money can never fund a branch."
      size="md"
    >
      {open ? <CreateBranchForm onCreated={onCreated} /> : null}
    </Dialog>
  );
}

function CreateBranchForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { hints, workspace } = useUi();
  const f = useFormat();
  const real = workspace === "REAL";
  const [profile, setProfile] = useState<Profile>(hints.defaultProfile);
  const [capital, setCapital] = useState("100");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    // REAL: the single external seed is fixed (the server enforces it as well).
    const capitalCents = real ? hints.realSeedCents : parseMoney(capital);
    if (capitalCents === null || capitalCents < 100) {
      setError("Enter an initial capital of at least 1.00");
      return;
    }
    startTransition(async () => {
      const result = await createRootBranchAction(workspace, {
        profile,
        capitalCents,
        notes: notes || undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(`Branch ${result.data.code} created`);
      onCreated(result.data.id);
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-fg-muted">
          Profile (fixed at birth)
        </legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {PROFILES.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={profile === p}
              onClick={() => setProfile(p)}
              className={cn(
                "flex flex-col gap-1 rounded-xl border bg-surface-2 p-3 text-left transition-colors",
                profile === p ? "border-fg/60" : "border-border hover:border-border-strong",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: PROFILE_COLOR_VAR[p] }}
                  aria-hidden
                />
                {PROFILE_LABEL[p]}
              </span>
              <span className="text-xs text-fg-subtle">{PROFILE_DESCRIPTION[p]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {real ? (
        <div
          className="rounded-xl border border-border bg-surface-2 px-4 py-3"
          data-testid="real-seed"
        >
          <p className="text-[13px] font-medium text-fg-muted">Initial external seed</p>
          <p className="mt-1 num text-2xl font-semibold">{f.money(hints.realSeedCents)}</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Fixed by REAL V1. External capital enters a REAL ledger only once: after this root,
            every new branch comes from strategy splits and no other root can be created.
          </p>
          {error ? (
            <p className="mt-2 text-xs text-critical" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <Field label="Initial capital" error={error} hint="DEMO: any amount, any number of roots.">
          {(p) => (
            <AmountInput
              {...p}
              suffix="€"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
            />
          )}
        </Field>
      )}
      <Field label="Notes (optional)">
        {(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create branch"}
        </Button>
      </div>
    </form>
  );
}
