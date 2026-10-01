"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { parseMoney } from "@/domain/money";
import { PROFILES, type Profile } from "@/domain/types";
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
      description="A root brings new external capital into the ecosystem. BANK money can never fund a branch."
      size="md"
    >
      {open ? <CreateBranchForm onCreated={onCreated} /> : null}
    </Dialog>
  );
}

function CreateBranchForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { hints } = useUi();
  const [profile, setProfile] = useState<Profile>(hints.defaultProfile);
  const [capital, setCapital] = useState("100");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const capitalCents = parseMoney(capital);
    if (capitalCents === null || capitalCents < 100) {
      setError("Enter an initial capital of at least 1.00");
      return;
    }
    startTransition(async () => {
      const result = await createRootBranchAction({
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
      <Field label="Initial capital" error={error}>
        {(p) => (
          <AmountInput
            {...p}
            suffix="€"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
          />
        )}
      </Field>
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
