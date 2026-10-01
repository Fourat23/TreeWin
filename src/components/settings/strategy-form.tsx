"use client";

import { RotateCcw, Save } from "lucide-react";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { BP_SCALE, formatMultiple } from "@/domain/money";
import { planP1, thresholdMultipleBp } from "@/domain/strategy/milestones";
import {
  CHILD_PROFILE_ASSIGNMENTS,
  P1_TRIGGERS,
  SAME_EVENT_POLICIES,
  type StrategySettings,
} from "@/domain/strategy/settings";
import { PROFILES, type Profile } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PROFILE_COLOR_VAR, PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { resetSettingsAction, saveSettingsAction } from "@/server/actions/workspace-actions";
import { ScaledInput, type Scale } from "./scaled-input";

const TRIGGER_LABEL: Record<(typeof P1_TRIGGERS)[number], string> = {
  CAPITAL_MULTIPLE: "Capital ≥ S × multiple (V1 default: 2.80 × S)",
  TARGET_PATH: "Alternative — capital ≥ value after N wins at target odds",
  WIN_COUNT: "Alternative — after N winning rounds",
};

const ASSIGNMENT_LABEL: Record<(typeof CHILD_PROFILE_ASSIGNMENTS)[number], string> = {
  QUOTA: "Quota (deterministic, follows the distribution)",
  RANDOM: "Weighted random",
  INHERIT: "Inherit the parent profile",
};

type Issues = Record<string, string>;

export function StrategyForm({ initial }: { initial: StrategySettings }) {
  const f = useFormat();
  const { notifyMutation, workspace } = useUi();
  const [draft, setDraft] = useState<StrategySettings>(initial);
  const [formKey, setFormKey] = useState(0);
  const [issues, setIssues] = useState<Issues>({});
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const patch = (fn: (d: StrategySettings) => StrategySettings) =>
    setDraft((d) => fn(structuredClone(d)));
  const distributionTotal =
    draft.profileDistribution.HARVEST +
    draft.profileDistribution.BALANCED +
    draft.profileDistribution.GROWTH;

  const p1Preview = useMemo(() => planP1(10_000, draft), [draft]);

  function save() {
    startTransition(async () => {
      const result = await saveSettingsAction(workspace, draft);
      if (!result.ok) {
        const list =
          (result.details?.issues as { path: string; message: string }[] | undefined) ?? [];
        setIssues(Object.fromEntries(list.map((i) => [i.path, i.message])));
        toast.error(result.message);
        return;
      }
      setIssues({});
      toast.success(`Strategy settings saved (${workspace})`, {
        description: result.data.strategyChanged
          ? "Strategy rules changed: new branches and tickets record the new strategy revision. Existing history is never reinterpreted."
          : "Display / storage preferences only — the strategy revision is unchanged.",
      });
      notifyMutation();
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await resetSettingsAction(workspace);
      if (result.ok) {
        toast.success("Defaults restored");
        notifyMutation();
        window.location.reload();
      } else toast.error(result.message);
    });
  }

  const num = (
    label: ReactNode,
    path: string,
    scale: Scale,
    value: number | null,
    set: (v: number | null) => void,
    hint?: ReactNode,
    nullable = false,
  ) => (
    <Field key={path} label={label} hint={hint} error={issues[path]}>
      {(p) => (
        <ScaledInput
          key={`${formKey}-${path}`}
          {...p}
          scale={scale}
          value={value}
          nullable={nullable}
          onChange={set}
        />
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Profiles distribution"
          description="Used when a child is created automatically. Must total 100 %."
        />
        <CardBody className="grid gap-4 sm:grid-cols-4">
          {PROFILES.map((p) =>
            num(
              <ProfileLabel profile={p} />,
              `profileDistribution.${p}`,
              "percent",
              draft.profileDistribution[p],
              (v) => patch((d) => ((d.profileDistribution[p] = v ?? 0), d)),
            ),
          )}
          <Field label="Child profile assignment">
            {(p) => (
              <Select
                {...p}
                value={draft.childProfileAssignment}
                onChange={(e) =>
                  patch(
                    (d) => (
                      (d.childProfileAssignment = e.target
                        .value as StrategySettings["childProfileAssignment"]),
                      d
                    ),
                  )
                }
              >
                {CHILD_PROFILE_ASSIGNMENTS.map((a) => (
                  <option key={a} value={a}>
                    {ASSIGNMENT_LABEL[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p
            className={cn(
              "text-xs sm:col-span-4",
              distributionTotal === BP_SCALE ? "text-fg-subtle" : "text-critical",
            )}
          >
            Total {f.pct(distributionTotal, 2)}{" "}
            {issues.profileDistribution ? `— ${issues.profileDistribution}` : ""}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="P1 — first harvest (all profiles)"
          description="S = birth capital. At P1: BANK receives a multiple of S, a child is created with a multiple of S, the rest stays."
        />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              className="size-4 accent-[var(--fg)]"
              checked={draft.p1.enabled}
              onChange={(e) => patch((d) => ((d.p1.enabled = e.target.checked), d))}
            />
            P1 enabled
          </label>
          <Field label="Trigger" className="sm:col-span-3">
            {(p) => (
              <Select
                {...p}
                value={draft.p1.trigger}
                onChange={(e) =>
                  patch(
                    (d) => (
                      (d.p1.trigger = e.target.value as StrategySettings["p1"]["trigger"]),
                      d
                    ),
                  )
                }
              >
                {P1_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {num("Target odds", "p1.targetOddsBp", "odds", draft.p1.targetOddsBp, (v) =>
            patch((d) => ((d.p1.targetOddsBp = v ?? d.p1.targetOddsBp), d)),
          )}
          {num("Target wins (N)", "p1.targetWins", "int", draft.p1.targetWins, (v) =>
            patch((d) => ((d.p1.targetWins = v ?? d.p1.targetWins), d)),
          )}
          {num(
            "Capital multiple",
            "p1.capitalMultipleBp",
            "multiple",
            draft.p1.capitalMultipleBp,
            (v) => patch((d) => ((d.p1.capitalMultipleBp = v ?? d.p1.capitalMultipleBp), d)),
            "For the “S × multiple” trigger",
          )}
          {num("BANK amount (× S)", "p1.bankMultipleBp", "multiple", draft.p1.bankMultipleBp, (v) =>
            patch((d) => ((d.p1.bankMultipleBp = v ?? 0), d)),
          )}
          {num(
            "Child capital (× S)",
            "p1.childMultipleBp",
            "multiple",
            draft.p1.childMultipleBp,
            (v) => patch((d) => ((d.p1.childMultipleBp = v ?? 0), d)),
          )}
          {num(
            "Mother keeps at least (× S)",
            "p1.minMotherRemainingBp",
            "multiple",
            draft.p1.minMotherRemainingBp,
            (v) => patch((d) => ((d.p1.minMotherRemainingBp = v ?? 0), d)),
          )}
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted sm:col-span-3">
            Example with S = {f.money(10_000)}: P1 fires at{" "}
            <span className="num text-fg">{f.money(p1Preview.thresholdCents)}</span>
            {p1Preview.requiredWins ? ` and ${p1Preview.requiredWins} wins` : ""} (≈{" "}
            {formatMultiple(p1Preview.thresholdCents)} × S) → BANK {f.money(p1Preview.bankCents)},
            child {f.money(p1Preview.childCents)}, the mother keeps the rest.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Post-P1 thresholds, splits & caps"
          description="Thresholds are relative to S: first × factor^k. At each threshold the capital is split BANK / child / kept."
        />
        <CardBody className="flex flex-col gap-5">
          {PROFILES.map((p) => {
            const rules = draft.profiles[p];
            const keep = BP_SCALE - rules.bankShareBp - rules.childShareBp;
            const sequence = [0, 1, 2, 3]
              .map((k) => `${formatMultiple(thresholdMultipleBp(rules, k))}×S`)
              .join(" → ");
            const set = (key: keyof typeof rules) => (v: number | null) =>
              patch((d) => ((d.profiles[p][key] = v ?? 0), d));
            return (
              <div key={p} className="rounded-xl border border-border p-4">
                <p className="mb-3 flex items-center justify-between gap-2">
                  <ProfileLabel profile={p} />
                  <span className="num text-xs text-fg-subtle">{sequence} …</span>
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                  {num(
                    "First threshold (× S)",
                    `profiles.${p}.firstThresholdBp`,
                    "multiple",
                    rules.firstThresholdBp,
                    set("firstThresholdBp"),
                  )}
                  {num(
                    "Growth factor",
                    `profiles.${p}.thresholdFactorBp`,
                    "multiple",
                    rules.thresholdFactorBp,
                    set("thresholdFactorBp"),
                  )}
                  {num(
                    "BANK share",
                    `profiles.${p}.bankShareBp`,
                    "percent",
                    rules.bankShareBp,
                    set("bankShareBp"),
                  )}
                  {num(
                    "Child share",
                    `profiles.${p}.childShareBp`,
                    "percent",
                    rules.childShareBp,
                    set("childShareBp"),
                    `keeps ${f.pct(keep, 0)}`,
                  )}
                  {num("Cap", `profiles.${p}.capCents`, "money", rules.capCents, set("capCents"))}
                  {num(
                    "Odds corridor min",
                    `profiles.${p}.oddsTargetMinBp`,
                    "odds",
                    rules.oddsTargetMinBp,
                    set("oddsTargetMinBp"),
                    "informational",
                  )}
                  {num(
                    "Odds corridor max",
                    `profiles.${p}.oddsTargetMaxBp`,
                    "odds",
                    rules.oddsTargetMaxBp,
                    set("oddsTargetMaxBp"),
                  )}
                </div>
                {issues[`profiles.${p}`] ? (
                  <p className="mt-2 text-xs text-critical">{issues[`profiles.${p}`]}</p>
                ) : null}
              </div>
            );
          })}
          <div className="grid gap-4 sm:grid-cols-3">
            {num(
              "Mature: BANK share of profit above cap",
              "mature.bankShareBp",
              "percent",
              draft.mature.bankShareBp,
              (v) => patch((d) => ((d.mature.bankShareBp = v ?? 0), d)),
              `the remaining ${f.pct(BP_SCALE - draft.mature.bankShareBp, 0)} creates a new branch`,
            )}
            {num(
              "Minimum child capital",
              "minChildCapitalCents",
              "money",
              draft.minChildCapitalCents,
              (v) => patch((d) => ((d.minChildCapitalCents = v ?? 0), d)),
              "Smaller child shares go to BANK instead",
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tickets & protections" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {num(
            "Protocol odds min",
            "odds.minBp",
            "odds",
            draft.odds.minBp,
            (v) => patch((d) => ((d.odds.minBp = v ?? d.odds.minBp), d)),
            "Below: warning only",
          )}
          {num(
            "Hard max odds",
            "odds.maxBp",
            "odds",
            draft.odds.maxBp,
            (v) => patch((d) => ((d.odds.maxBp = v ?? d.odds.maxBp), d)),
            "Above: refused in REAL (DEMO: explicit override)",
          )}
          <Field label="Same match on two branches">
            {(p) => (
              <Select
                {...p}
                value={draft.sameEventPolicy}
                onChange={(e) =>
                  patch(
                    (d) => (
                      (d.sameEventPolicy = e.target.value as StrategySettings["sameEventPolicy"]),
                      d
                    ),
                  )
                }
              >
                {SAME_EVENT_POLICIES.map((s) => (
                  <option key={s} value={s}>
                    {s === "BLOCK" ? "Block (strict in REAL, override in DEMO)" : "Warn only"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {num(
            "Max concurrent pending tickets",
            "limits.maxPendingTickets",
            "int",
            draft.limits.maxPendingTickets,
            (v) => patch((d) => ((d.limits.maxPendingTickets = v), d)),
            undefined,
            true,
          )}
          {num(
            "Max tickets per day",
            "limits.maxTicketsPerDay",
            "int",
            draft.limits.maxTicketsPerDay,
            (v) => patch((d) => ((d.limits.maxTicketsPerDay = v), d)),
            undefined,
            true,
          )}
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--fg)]"
              checked={draft.voidCountsAsRound}
              onChange={(e) => patch((d) => ((d.voidCountsAsRound = e.target.checked), d))}
            />
            Void tickets advance the round counter
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Display, versioning & storage" />
        <CardBody className="grid gap-4 sm:grid-cols-5">
          <Field
            label="Strategy version"
            error={issues.strategyVersion}
            hint="Baseline 1.0 = final V1 rules"
          >
            {(p) => (
              <Input
                {...p}
                value={draft.strategyVersion}
                onChange={(e) => patch((d) => ((d.strategyVersion = e.target.value), d))}
              />
            )}
          </Field>
          {num(
            "Automatic snapshots kept",
            "backups.keepAutomatic",
            "int",
            draft.backups.keepAutomatic,
            (v) => patch((d) => ((d.backups.keepAutomatic = v ?? 50), d)),
            "Manual backups are never deleted",
          )}
          <Field label="Currency" error={issues.currency}>
            {(p) => (
              <Input
                {...p}
                value={draft.currency}
                onChange={(e) => patch((d) => ((d.currency = e.target.value.toUpperCase()), d))}
              />
            )}
          </Field>
          <Field label="Locale" error={issues.locale}>
            {(p) => (
              <Input
                {...p}
                value={draft.locale}
                onChange={(e) => patch((d) => ((d.locale = e.target.value), d))}
              />
            )}
          </Field>
          <Field label="Round term" error={issues.roundLabel}>
            {(p) => (
              <Input
                {...p}
                value={draft.roundLabel}
                onChange={(e) => patch((d) => ((d.roundLabel = e.target.value), d))}
              />
            )}
          </Field>
          <Field label="Round prefix" error={issues.roundShortLabel}>
            {(p) => (
              <Input
                {...p}
                value={draft.roundShortLabel}
                onChange={(e) => patch((d) => ((d.roundShortLabel = e.target.value), d))}
              />
            )}
          </Field>
          {num(
            "Min sample for edge",
            "analytics.minSampleSize",
            "int",
            draft.analytics.minSampleSize,
            (v) => patch((d) => ((d.analytics.minSampleSize = v ?? 30), d)),
          )}
        </CardBody>
      </Card>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface/95 p-3 backdrop-blur">
        <p className="mr-auto text-xs text-fg-subtle">
          {dirty ? "Unsaved changes. " : ""}Changes apply to future evaluations; each save is
          versioned in the settings history.
        </p>
        <Button
          variant="ghost"
          disabled={!dirty || pending}
          onClick={() => {
            setDraft(initial);
            setIssues({});
            setFormKey((k) => k + 1);
          }}
        >
          Discard
        </Button>
        <Button variant="ghost" disabled={pending} onClick={reset}>
          <RotateCcw /> Defaults
        </Button>
        <Button variant="primary" disabled={!dirty || pending} onClick={save}>
          <Save /> Save strategy
        </Button>
      </div>
    </div>
  );
}

function ProfileLabel({ profile }: { profile: Profile }) {
  return (
    <span className="flex items-center gap-2 text-sm font-medium text-fg">
      <span
        className="size-2 rounded-full"
        style={{ background: PROFILE_COLOR_VAR[profile] }}
        aria-hidden
      />
      {PROFILE_LABEL[profile]}
    </span>
  );
}
