"use client";

import { ArrowLeft, FlaskConical, Lock, Search, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { centsToDecimalString, formatOdds } from "@/domain/money";
import { PROTOCOL_STATUSES, type Checklist, type ProtocolStatus } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProfileDot, StatusBadge } from "@/components/ui/domain-badges";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { todayIso } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { PlayableBranchDTO } from "@/server/queries/dto";
import type { PolicyViolation, TicketRules } from "@/domain/bets/policy";
import type { TicketConflicts } from "@/server/services/bet-service";
import {
  checkTicketConflictsAction,
  createTicketAction,
  listPlayableBranchesAction,
} from "@/server/actions/ticket-actions";
import { ChecklistEditor } from "./checklist-editor";
import { computeTicketPreview } from "./ticket-math";

export interface TicketPrefill {
  sport?: string;
  competition?: string;
  eventName?: string;
  marketName?: string;
  selection?: string;
  oddsBp?: number;
  eventDate?: string;
  eventTime?: string;
  notes?: string;
  closingOddsBp?: number;
  checklist?: Checklist;
}

const SPORTS = [
  "Football",
  "Tennis",
  "Basketball",
  "Rugby",
  "Handball",
  "Ice hockey",
  "Volleyball",
];
const MARKETS = [
  "Vainqueur du match",
  "Vainqueur (prolongations incluses)",
  "Double chance",
  "Vainqueur",
];

interface FormState {
  sport: string;
  competition: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  marketName: string;
  selection: string;
  odds: string;
  stake: string;
  eventDate: string;
  eventTime: string;
  notes: string;
  protocolStatus: ProtocolStatus | "";
  confidence: string;
  singleMatch: boolean;
  checklist: Checklist;
}

function initialForm(prefill?: TicketPrefill): FormState {
  return {
    sport: prefill?.sport ?? "Football",
    competition: prefill?.competition ?? "",
    eventName: prefill?.eventName ?? "",
    homeTeam: "",
    awayTeam: "",
    marketName: prefill?.marketName ?? "Vainqueur du match",
    selection: prefill?.selection ?? "",
    odds: prefill?.oddsBp ? formatOdds(prefill.oddsBp) : "",
    stake: "",
    eventDate: prefill?.eventDate ?? todayIso(),
    eventTime: prefill?.eventTime ?? "",
    notes: prefill?.notes ?? "",
    protocolStatus: "",
    confidence: "",
    singleMatch: false,
    checklist: prefill?.checklist ?? {},
  };
}

export function NewTicketDialog({
  request,
  onClose,
  onCreated,
}: {
  request: { branchId?: string; prefill?: TicketPrefill; candidateId?: string } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const open = request !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
      title="New round"
      description="Record a ticket you placed manually on Winamax. One ticket = one single match."
      size="lg"
    >
      {open ? <NewTicketFlow request={request} onCreated={onCreated} /> : null}
    </Dialog>
  );
}

function NewTicketFlow({
  request,
  onCreated,
}: {
  request: { branchId?: string; prefill?: TicketPrefill; candidateId?: string };
  onCreated: () => void;
}) {
  const f = useFormat();
  const { workspace } = useUi();
  const [branches, setBranches] = useState<PlayableBranchDTO[] | null>(null);
  const [branchId, setBranchId] = useState<string | null>(request.branchId ?? null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    void listPlayableBranchesAction(workspace).then((result) => {
      if (active) setBranches(result.ok ? result.data : []);
    });
    return () => {
      active = false;
    };
  }, [workspace]);

  const branch = branches?.find((b) => b.id === branchId) ?? null;
  const filtered = (branches ?? []).filter((b) =>
    b.code.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (branches === null) {
    return <p className="py-10 text-center text-sm text-fg-subtle">Loading branches…</p>;
  }

  if (!branch) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">
          Step 1 — choose an <strong className="text-fg">active or mature</strong> branch without a
          pending ticket.
        </p>
        {branches.length > 6 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-fg-subtle" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branch code…"
              className="pl-9"
              aria-label="Search branch"
            />
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-subtle">
            No playable branch. Every alive branch already has a pending ticket, or the ecosystem is
            empty.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {filtered.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setBranchId(b.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-3"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ProfileDot profile={b.profile} className="size-2.5" />
                    <span className="font-mono text-sm font-semibold">{b.code}</span>
                    <StatusBadge status={b.status} />
                  </span>
                  <span className="text-right">
                    <span className="block num text-sm font-medium">
                      {f.money(b.currentCapitalCents)}
                    </span>
                    <span className="block text-[11px] text-fg-subtle">
                      next {f.round(b.nextRoundNumber)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <TicketForm
      branch={branch}
      prefill={request.prefill}
      candidateId={request.candidateId}
      onBack={request.branchId ? undefined : () => setBranchId(null)}
      onCreated={onCreated}
    />
  );
}

function TicketForm({
  branch,
  prefill,
  candidateId,
  onBack,
  onCreated,
}: {
  branch: PlayableBranchDTO;
  prefill?: TicketPrefill;
  candidateId?: string;
  onBack?: () => void;
  onCreated: () => void;
}) {
  const f = useFormat();
  const { hints, workspace } = useUi();
  const real = workspace === "REAL";
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm(prefill),
    stake: centsToDecimalString(branch.suggestedStakeCents),
  }));
  const [showDetails, setShowDetails] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<TicketConflicts | null>(null);
  const [serverViolations, setServerViolations] = useState<PolicyViolation[] | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setServerViolations(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const corridor = hints.corridors[branch.profile];
  const rules: TicketRules = {
    oddsMinBp: hints.oddsMinBp,
    oddsMaxBp: hints.oddsMaxBp,
    corridor,
    sameEventPolicy: hints.sameEventPolicy,
    maxPendingTickets: conflicts?.maxPendingTickets ?? null,
    maxTicketsPerDay: conflicts?.maxTicketsPerDay ?? null,
  };
  const sameEvent = form.eventName.trim().length >= 3 ? (conflicts?.sameEvent ?? []) : [];
  // REAL: the stake is fixed by the V1 rule (whole capital / capped principal).
  const stakeText = real ? centsToDecimalString(branch.suggestedStakeCents) : form.stake;
  const preview = computeTicketPreview({
    workspace,
    branch,
    rules,
    stake: stakeText,
    odds: form.odds,
    sameEventBranchCodes: sameEvent.map((c) => c.branchCode),
    pendingLimitReached: conflicts?.pendingLimitReached ?? false,
    dailyLimitReached: conflicts?.dailyLimitReached ?? false,
  });

  // Live same-match check (debounced).
  useEffect(() => {
    const name = form.eventName.trim();
    if (name.length < 3 || !form.eventDate) return;
    const timer = window.setTimeout(() => {
      void checkTicketConflictsAction(workspace, {
        eventName: name,
        eventDate: form.eventDate,
        branchId: branch.id,
      }).then((result) => setConflicts(result.ok ? result.data : null));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.eventName, form.eventDate, branch.id, workspace]);

  const violations = serverViolations ?? preview.violations;
  const blockers = violations.filter((v) => !v.overridable);
  const overridable = violations.filter((v) => v.overridable);
  const needsOverride = blockers.length === 0 && overridable.length > 0;
  const outsideV1 = overridable.some((v) => v.code !== "PENDING_LIMIT" && v.code !== "DAILY_LIMIT");

  function submit() {
    const nextErrors: Record<string, string> = {};
    if (!form.singleMatch) nextErrors.singleMatch = "Confirm the ticket covers exactly one match";
    if (preview.stakeError || preview.stakeCents === null)
      nextErrors.stake = preview.stakeError ?? "Stake is required";
    if (preview.oddsError || preview.oddsBp === null)
      nextErrors.odds = preview.oddsError ?? "Odds are required";
    for (const key of ["eventName", "competition", "selection", "marketName", "sport"] as const) {
      if (!form[key].trim()) nextErrors[key] = "Required";
    }
    if (blockers.length > 0) nextErrors.form = blockers.map((b) => b.message).join(" · ");
    if (needsOverride && (!overrideConfirmed || overrideReason.trim().length < 3)) {
      nextErrors.override = "Confirm the override and give a reason";
    }
    setErrors(nextErrors);
    if (
      Object.keys(nextErrors).length > 0 ||
      preview.stakeCents === null ||
      preview.oddsBp === null
    )
      return;

    const stakeCents = preview.stakeCents;
    const oddsBp = preview.oddsBp;
    startTransition(async () => {
      const result = await createTicketAction(workspace, {
        branchId: branch.id,
        candidateId,
        sport: form.sport,
        competition: form.competition,
        eventName: form.eventName,
        homeTeam: form.homeTeam || undefined,
        awayTeam: form.awayTeam || undefined,
        marketName: form.marketName,
        selection: form.selection,
        eventDate: form.eventDate,
        eventTime: form.eventTime || undefined,
        notes: form.notes || undefined,
        oddsBp,
        stakeCents,
        protocolStatus: form.protocolStatus || undefined,
        confidence: form.confidence ? Number(form.confidence) : undefined,
        closingOddsBp: prefill?.closingOddsBp,
        checklist: { ...form.checklist, singleMatch: "TRUE" },
        override: needsOverride ? { confirmed: true, reason: overrideReason } : undefined,
      });
      if (result.ok) {
        toast.success(`${branch.code} · ${f.round(result.data.roundNumber)} opened`, {
          description: result.data.warnings.join(" · ") || "Pending ticket recorded.",
        });
        onCreated();
        return;
      }
      if (result.code === "POLICY_VIOLATION") {
        const list = (result.details?.violations as PolicyViolation[] | undefined) ?? [];
        setServerViolations(list);
        setErrors(
          list.some((v) => !v.overridable)
            ? { form: list.map((v) => v.message).join(" · ") }
            : {
                override:
                  "Blocked by a rule. Override explicitly (journaled) or change the ticket.",
              },
        );
        return;
      }
      const issues =
        (result.details?.issues as { path: string; message: string }[] | undefined) ?? [];
      const mapped: Record<string, string> = {};
      for (const issue of issues) mapped[issue.path.split(".")[0] ?? "form"] = issue.message;
      setErrors({ ...mapped, form: result.message });
    });
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_260px]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            {onBack ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onBack}
                aria-label="Choose another branch"
              >
                <ArrowLeft />
              </Button>
            ) : null}
            <ProfileDot profile={branch.profile} className="size-2.5" />
            <span className="font-mono font-semibold">{branch.code}</span>
            <span className="text-fg-subtle">·</span>
            <span className="text-fg-muted">
              {f.roundLabel} {branch.nextRoundNumber}
            </span>
          </div>
          <StatusBadge status={branch.status} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sport" error={errors.sport}>
            {(p) => (
              <>
                <Input
                  {...p}
                  list="ct-sports"
                  value={form.sport}
                  onChange={(e) => set("sport", e.target.value)}
                />
                <datalist id="ct-sports">
                  {SPORTS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Competition" error={errors.competition}>
            {(p) => (
              <Input
                {...p}
                value={form.competition}
                placeholder="LaLiga"
                onChange={(e) => set("competition", e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Match (single event)"
          error={errors.eventName}
          hint="Exactly one match, e.g. “Real Madrid - Getafe”"
        >
          {(p) => (
            <Input
              {...p}
              value={form.eventName}
              placeholder="Real Madrid - Getafe"
              onChange={(e) => set("eventName", e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Market" error={errors.marketName}>
            {(p) => (
              <>
                <Input
                  {...p}
                  list="ct-markets"
                  value={form.marketName}
                  onChange={(e) => set("marketName", e.target.value)}
                />
                <datalist id="ct-markets">
                  {MARKETS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Selection" error={errors.selection}>
            {(p) => (
              <Input
                {...p}
                value={form.selection}
                placeholder="Real Madrid"
                onChange={(e) => set("selection", e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Odds" error={errors.odds ?? preview.oddsError}>
            {(p) => (
              <AmountInput
                {...p}
                value={form.odds}
                placeholder="1.30"
                onChange={(e) => set("odds", e.target.value)}
              />
            )}
          </Field>
          <Field
            label={
              real ? (
                <span className="flex items-center gap-1">
                  Stake <Lock className="size-3" aria-label="fixed by the V1 rule" />
                </span>
              ) : (
                "Stake"
              )
            }
            error={errors.stake ?? preview.stakeError}
          >
            {(p) => (
              <AmountInput
                {...p}
                suffix="€"
                value={stakeText}
                readOnly={real}
                title={
                  real ? "V1 rule: the whole capital (capped principal when mature)" : undefined
                }
                className={real ? "cursor-not-allowed opacity-80" : undefined}
                onChange={(e) => set("stake", e.target.value)}
                data-testid="ticket-stake"
              />
            )}
          </Field>
          <Field label="Match day" error={errors.eventDate}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={form.eventDate}
                onChange={(e) => set("eventDate", e.target.value)}
              />
            )}
          </Field>
          <Field label="Kick-off">
            {(p) => (
              <Input
                {...p}
                type="time"
                value={form.eventTime}
                onChange={(e) => set("eventTime", e.target.value)}
              />
            )}
          </Field>
        </div>

        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
            errors.singleMatch ? "border-critical/50 bg-critical/5" : "border-border bg-surface-2",
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--fg)]"
            checked={form.singleMatch}
            onChange={(e) => set("singleMatch", e.target.checked)}
          />
          <span>
            <span className="font-medium text-fg">
              I confirm this Winamax ticket covers one single match.
            </span>
            <span className="block text-xs text-fg-subtle">
              Combos (several matches) are never allowed.
            </span>
            {errors.singleMatch ? (
              <span className="block text-xs text-critical">{errors.singleMatch}</span>
            ) : null}
          </span>
        </label>

        {sameEvent.length > 0 ? (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-critical/40 bg-critical/8 px-3 py-2.5 text-sm"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-critical" />
            <div>
              <p className="font-medium text-fg">Same match already pending on another branch</p>
              <p className="text-fg-muted">
                {sameEvent.map((s) => `${s.branchCode} (${s.selection})`).join(", ")} — correlated
                branches can die together.{" "}
                {hints.sameEventPolicy !== "BLOCK"
                  ? "Warning only."
                  : real
                    ? "Refused in REAL: one branch per match."
                    : "Blocked unless you explicitly override (DEMO)."}
              </p>
            </div>
          </div>
        ) : null}

        {blockers.length > 0 ? (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-lg border border-critical/40 bg-critical/8 px-3 py-2.5 text-sm"
          >
            <p className="flex items-center gap-2 font-medium text-critical">
              <ShieldAlert className="size-4" /> Refused by the V1 rules
              {real ? " (REAL workspace — no override)" : ""}
            </p>
            {blockers.map((v) => (
              <p key={v.code} className="text-fg-muted">
                {v.message}
              </p>
            ))}
          </div>
        ) : null}

        {needsOverride ? (
          <div
            className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-3"
            data-testid="override-box"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <FlaskConical className="size-4" />
              {outsideV1
                ? "Experiment outside the V1 rules — DEMO only"
                : "Override a personal limit"}
            </p>
            {overridable.map((v) => (
              <p key={v.code} className="text-sm text-fg">
                {v.message}
              </p>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--fg)]"
                checked={overrideConfirmed}
                onChange={(e) => setOverrideConfirmed(e.target.checked)}
              />
              {outsideV1
                ? "I deliberately record this ticket outside the V1 rules (it stays labelled as such)."
                : "I understand the risk and override this limit."}
            </label>
            <Input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Reason (journaled with the ticket)"
              aria-label="Override reason"
            />
            {errors.override ? <p className="text-xs text-critical">{errors.override}</p> : null}
          </div>
        ) : null}

        <button
          type="button"
          className="self-start text-xs font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
        >
          {showDetails ? "Hide" : "Show"} protocol, teams & notes
        </button>
        {showDetails ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Home team">
                {(p) => (
                  <Input
                    {...p}
                    value={form.homeTeam}
                    onChange={(e) => set("homeTeam", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Away team">
                {(p) => (
                  <Input
                    {...p}
                    value={form.awayTeam}
                    onChange={(e) => set("awayTeam", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Protocol status">
                {(p) => (
                  <Select
                    {...p}
                    value={form.protocolStatus}
                    onChange={(e) => set("protocolStatus", e.target.value as ProtocolStatus | "")}
                  >
                    <option value="">—</option>
                    {PROTOCOL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0) + s.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-fg-muted">Confidence</span>
                <Segmented
                  label="Confidence"
                  value={form.confidence}
                  onChange={(v) => set("confidence", v)}
                  options={[
                    { value: "", label: "—" },
                    ...["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v })),
                  ]}
                />
              </div>
            </div>
            <ChecklistEditor value={form.checklist} onChange={(c) => set("checklist", c)} />
            <Field label="Notes">
              {(p) => (
                <Textarea
                  {...p}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}
        {errors.form ? <p className="text-sm text-critical">{errors.form}</p> : null}
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <dl className="flex flex-col gap-2.5 text-sm">
            <Row label="Current capital" value={f.money(branch.currentCapitalCents)} />
            <Row
              label="Stake"
              value={preview.stakeCents !== null ? f.money(preview.stakeCents) : "—"}
            />
            <Row label="Odds" value={preview.oddsBp !== null ? f.odds(preview.oddsBp) : "—"} />
            <div className="my-1 h-px bg-border" />
            <Row
              label="Potential return"
              value={
                preview.potentialReturnCents !== null ? f.money(preview.potentialReturnCents) : "—"
              }
              strong
            />
            <Row
              label="Potential profit"
              value={
                preview.potentialProfitCents !== null
                  ? f.money(preview.potentialProfitCents, { signed: true })
                  : "—"
              }
            />
          </dl>
          <p className="mt-3 text-xs text-fg-subtle">
            {branch.status === "MATURE"
              ? `Mature branch: V1 stake = capped principal ${f.money(branch.suggestedStakeCents)}.`
              : `V1 stake = the whole capital ${f.money(branch.suggestedStakeCents)}.`}{" "}
            {real
              ? "If Winamax does not accept this amount, simply wait — no ticket is mandatory."
              : ""}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            Odds: max {f.odds(hints.oddsMaxBp)} · {branch.profile.toLowerCase()} corridor{" "}
            {f.odds(corridor.minBp)}–{f.odds(corridor.maxBp)} (informational)
          </p>
        </div>
        {preview.warnings.map((w) => (
          <p key={w} className="flex gap-2 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            {w}
          </p>
        ))}
        <Button type="submit" variant="primary" size="lg" disabled={pending || blockers.length > 0}>
          {pending ? "Recording…" : "Create pending ticket"}
        </Button>
        <p className="text-[11px] leading-relaxed text-fg-subtle">
          CELLTREE never places bets. Place the ticket yourself on Winamax, then record it here.
        </p>
      </aside>
    </form>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={cn("text-right num", strong ? "text-base font-semibold text-fg" : "text-fg")}>
        {value}
      </dd>
    </div>
  );
}
