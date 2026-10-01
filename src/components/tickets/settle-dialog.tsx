"use client";

import { CircleCheck, CircleDot, CircleX, Crown, GitFork, Landmark, Skull } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { PROFILES, type Profile, type SettleResult } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/field";
import { HARVEST_LABEL, PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import {
  previewSettlementAction,
  settleTicketAction,
  type SettlementPreviewData,
} from "@/server/actions/ticket-actions";

const RESULTS: { value: SettleResult; label: string; Icon: typeof CircleCheck; tone: string }[] = [
  {
    value: "WON",
    label: "Won",
    Icon: CircleCheck,
    tone: "data-[on=true]:border-good/60 data-[on=true]:bg-good/10 data-[on=true]:text-good",
  },
  {
    value: "LOST",
    label: "Lost",
    Icon: CircleX,
    tone: "data-[on=true]:border-critical/60 data-[on=true]:bg-critical/10 data-[on=true]:text-critical",
  },
  {
    value: "VOID",
    label: "Void",
    Icon: CircleDot,
    tone: "data-[on=true]:border-border-strong data-[on=true]:bg-surface-3 data-[on=true]:text-fg",
  },
];

export function SettleDialog({
  betId,
  onClose,
  onSettled,
}: {
  betId: string | null;
  onClose: () => void;
  onSettled: () => void;
}) {
  return (
    <Dialog
      open={betId !== null}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
      title="Settle ticket"
      description="Review every consequence before committing. Nothing is written until you confirm."
      size="md"
    >
      {betId ? <SettleFlow key={betId} betId={betId} onSettled={onSettled} /> : null}
    </Dialog>
  );
}

function SettleFlow({ betId, onSettled }: { betId: string; onSettled: () => void }) {
  const f = useFormat();
  const { workspace } = useUi();
  const [result, setResult] = useState<SettleResult | null>(null);
  const [childProfiles, setChildProfiles] = useState<Profile[]>([]);
  const [preview, setPreview] = useState<SettlementPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!result) return;
    let active = true;
    void previewSettlementAction(workspace, { betId, result, childProfiles }).then((r) => {
      if (!active) return;
      if (r.ok) {
        setPreview(r.data);
        setError(null);
      } else {
        setPreview(null);
        setError(r.message);
      }
    });
    return () => {
      active = false;
    };
  }, [betId, result, childProfiles, workspace]);

  function confirm() {
    if (!result) return;
    startTransition(async () => {
      const r = await settleTicketAction(workspace, { betId, result, childProfiles });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      const parts = [
        r.data.childCodes.length ? `created ${r.data.childCodes.join(", ")}` : null,
        r.data.matured ? "now MATURE" : null,
        r.data.died ? "branch died" : null,
      ].filter(Boolean);
      toast.success(`${r.data.branchCode} settled ${result.toLowerCase()}`, {
        description: parts.join(" · ") || undefined,
      });
      onSettled();
    });
  }

  const plan = preview && preview.plan.result === result ? preview.plan : null;

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Result" className="grid grid-cols-3 gap-2">
        {RESULTS.map(({ value, label, Icon, tone }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={result === value}
            data-on={result === value}
            onClick={() => {
              setResult(value);
              setChildProfiles([]);
            }}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface-2 text-sm font-medium text-fg-muted transition-colors hover:border-border-strong",
              tone,
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {!result ? (
        <p className="text-center text-sm text-fg-subtle">Choose the result reported by Winamax.</p>
      ) : null}
      {error ? <p className="text-sm text-critical">{error}</p> : null}

      {plan && preview ? (
        <div className="flex flex-col gap-4">
          <div className="text-sm text-fg-muted">
            <span className="font-mono font-semibold text-fg">{preview.branchCode}</span> ·{" "}
            {f.round(preview.roundNumber)} · {preview.eventName} — {preview.selection} @
            {f.odds(preview.oddsBp)}
          </div>

          <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border text-center">
            <Cell label="Before" value={f.money(preview.capitalBeforeCents)} />
            <Cell
              label="Result"
              value={
                plan.result === "WON"
                  ? f.money(plan.profitLossCents, { signed: true })
                  : plan.result === "LOST"
                    ? f.money(-preview.stakeCents, { signed: true })
                    : "±0"
              }
              tone={
                plan.result === "WON"
                  ? "text-good"
                  : plan.result === "LOST"
                    ? "text-critical"
                    : undefined
              }
            />
            <Cell label="After" value={f.money(plan.capitalAfterBetCents)} strong />
          </div>

          {plan.harvests.map((h, index) => (
            <div key={index} className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                <GitFork className="size-4" aria-hidden />
                Branch split triggered — {HARVEST_LABEL[h.kind]}
              </p>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 text-fg-muted">
                    <Landmark className="size-3.5" aria-hidden /> BANK
                  </dt>
                  <dd className="num font-medium">{f.money(h.bankCents, { signed: true })}</dd>
                </div>
                {h.childIndex !== null && plan.children[h.childIndex] ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-fg-muted">
                      New child{" "}
                      <span className="font-mono font-semibold text-fg">
                        {plan.children[h.childIndex]?.code}
                      </span>
                    </dt>
                    <dd className="flex items-center gap-2">
                      <Select
                        aria-label="Child profile"
                        className="h-8 w-32 text-xs"
                        value={plan.children[h.childIndex]?.profile}
                        onChange={(e) => {
                          const next = plan.children.map((c) => c.profile);
                          next[h.childIndex as number] = e.target.value as Profile;
                          setChildProfiles(next);
                        }}
                      >
                        {PROFILES.map((p) => (
                          <option key={p} value={p}>
                            {PROFILE_LABEL[p]}
                          </option>
                        ))}
                      </Select>
                      <span className="num font-medium">{f.money(h.childCents)}</span>
                    </dd>
                  </div>
                ) : null}
                {h.childRedirectedToBank ? (
                  <p className="text-xs text-fg-subtle">
                    Child share below the minimum — sent to BANK instead.
                  </p>
                ) : null}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <dt className="text-fg-muted">{preview.branchCode} remaining</dt>
                  <dd className="num font-semibold">{f.money(h.remainingCents)}</dd>
                </div>
              </dl>
            </div>
          ))}

          {plan.matured ? (
            <p className="flex items-center gap-2 rounded-lg border border-mature/40 bg-mature/8 px-3 py-2 text-sm text-fg">
              <Crown className="size-4 text-mature" aria-hidden /> Cap reached —{" "}
              {preview.branchCode} becomes MATURE.
            </p>
          ) : null}
          {plan.died ? (
            <p className="flex items-center gap-2 rounded-lg border border-critical/40 bg-critical/8 px-3 py-2 text-sm text-fg">
              <Skull className="size-4 text-critical" aria-hidden /> {preview.branchCode} dies.{" "}
              {f.money(plan.lostCents)} lost — death is final and BANK can never revive it.
            </p>
          ) : null}
          {plan.result === "VOID" && !plan.countsAsRound ? (
            <p className="text-xs text-fg-subtle">Void rounds do not advance the round counter.</p>
          ) : null}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm text-fg-muted">
              Final capital{" "}
              <span className="num font-semibold text-fg">{f.money(plan.finalCapitalCents)}</span>
            </span>
            <Button
              variant={plan.result === "LOST" ? "danger" : "primary"}
              onClick={confirm}
              disabled={pending}
            >
              {pending ? "Saving…" : `Confirm ${plan.result.toLowerCase()}`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Cell({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <div className="border-r border-border px-3 py-3 last:border-r-0">
      <p className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</p>
      <p className={cn("mt-1 num text-sm", strong && "font-semibold", tone)}>{value}</p>
    </div>
  );
}
