"use client";

import { Ban, GitFork, Landmark, Pencil, Scale, Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatOdds, parseOdds } from "@/domain/money";
import { CHECKLIST_ITEMS, PROTOCOL_STATUSES, type ProtocolStatus } from "@/domain/types";
import { EventIcon } from "@/components/branch/event-icon";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ProfileBadge, ProfileDot, ResultBadge, StatusBadge } from "@/components/ui/domain-badges";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CHECKLIST_LABEL, DESTINATION_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { TicketDetailDTO } from "@/server/queries/tickets";
import {
  cancelTicketAction,
  revertSettlementAction,
  updateTicketAction,
} from "@/server/actions/ticket-actions";

export function TicketDetailView({ detail }: { detail: TicketDetailDTO }) {
  const f = useFormat();
  const { openSettle, openBranch } = useUi();
  const { bet, branch } = detail;
  const [dialog, setDialog] = useState<"edit" | "cancel" | "revert" | null>(null);
  const pending = bet.result === "PENDING" && !bet.cancelledAt;
  const impliedPct = (10_000 * 10_000) / bet.oddsBp;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-5">
        <Card>
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-fg-muted">
                  {bet.sport} · {bet.competition} · {f.day(bet.eventDate)}
                  {bet.eventTime ? ` ${bet.eventTime}` : ""}
                </p>
                <h2 className="mt-1 text-xl font-semibold">{bet.eventName}</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  {bet.marketName} — <span className="text-fg">{bet.selection}</span>
                </p>
              </div>
              <ResultBadge result={bet.result} cancelled={Boolean(bet.cancelledAt)} />
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Odds"
                value={f.odds(bet.oddsBp)}
                sub={`break-even ${f.pct(impliedPct, 1)}`}
              />
              <Stat label="Stake" value={f.money(bet.stakeCents)} />
              <Stat
                label={pending ? "Potential return" : "Return"}
                value={f.money(pending ? bet.potentialReturnCents : (bet.actualReturnCents ?? 0))}
              />
              <Stat
                label="Profit / loss"
                value={
                  bet.profitLossCents !== null
                    ? f.money(bet.profitLossCents, { signed: true })
                    : "—"
                }
                tone={
                  (bet.profitLossCents ?? 0) > 0
                    ? "text-good"
                    : (bet.profitLossCents ?? 0) < 0
                      ? "text-critical"
                      : undefined
                }
              />
              <Stat label="Capital before" value={f.money(bet.capitalBeforeCents)} />
              <Stat
                label="Capital after"
                value={bet.capitalAfterCents !== null ? f.money(bet.capitalAfterCents) : "—"}
              />
              <Stat
                label="Closing odds"
                value={bet.closingOddsBp ? f.odds(bet.closingOddsBp) : "—"}
              />
              <Stat
                label="CLV"
                value={bet.clvBp !== null ? f.pct(bet.clvBp, 1, true) : "—"}
                sub="odds taken / closing − 1"
                tone={(bet.clvBp ?? 0) > 0 ? "text-good" : undefined}
              />
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {pending ? (
                <>
                  <Button variant="primary" onClick={() => openSettle(bet.id)}>
                    <Scale /> Settle ticket
                  </Button>
                  <Button variant="danger" onClick={() => setDialog("cancel")}>
                    <Ban /> Cancel (entry error)
                  </Button>
                </>
              ) : null}
              <Button onClick={() => setDialog("edit")}>
                <Pencil /> Edit details
              </Button>
              {!pending && !bet.cancelledAt ? (
                <Button
                  variant="ghost"
                  onClick={() => setDialog("revert")}
                  disabled={!detail.revert.revertible}
                  title={detail.revert.reason ?? "Put the ticket back to pending"}
                >
                  <Undo2 /> Revert settlement
                </Button>
              ) : null}
            </div>
            {!pending && !detail.revert.revertible && !bet.cancelledAt ? (
              <p className="text-xs text-fg-subtle">
                Revert unavailable: {detail.revert.reason}. Use a manual adjustment on the branch if
                a correction is needed.
              </p>
            ) : null}
            {bet.cancelledAt ? (
              <p className="text-sm text-fg-muted">
                Cancelled on {f.dateTime(bet.cancelledAt)} — {bet.cancelReason}
              </p>
            ) : null}
            {bet.overrideReason ? (
              <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-fg-muted">
                Protection overridden: {bet.overrideReason}
              </p>
            ) : null}
            {bet.notes ? (
              <p className="text-sm whitespace-pre-wrap text-fg-muted">{bet.notes}</p>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="What this ticket did" description="Events journaled for this round" />
          <CardBody>
            <ol className="flex flex-col gap-2">
              {detail.events.map((e) => (
                <li key={e.id} className="flex items-start gap-2.5 text-sm">
                  <EventIcon type={e.type} className="mt-0.5" />
                  <span className="min-w-0 flex-1 text-fg-muted">{e.description}</span>
                  <span className="shrink-0 num text-xs text-fg-subtle">
                    {f.dateTime(e.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Branch" />
          <CardBody className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => openBranch(branch.id)}
              className="flex items-center gap-2 text-left"
            >
              <ProfileDot profile={branch.profile} className="size-2.5" />
              <span className="font-mono text-lg font-semibold">{branch.code}</span>
              <span className="text-sm text-fg-muted">· {f.round(bet.roundNumber)}</span>
            </button>
            <div className="flex flex-wrap gap-2">
              <ProfileBadge profile={branch.profile} />
              <StatusBadge status={branch.status} />
            </div>
            <p className="text-sm text-fg-muted">
              Current capital{" "}
              <span className="num text-fg">{f.money(branch.currentCapitalCents)}</span>
            </p>
          </CardBody>
        </Card>
        {detail.children.length > 0 || detail.bankTransactions.length > 0 ? (
          <Card>
            <CardHeader title="Split" />
            <CardBody className="flex flex-col gap-2 text-sm">
              {detail.bankTransactions.map((t) => (
                <p key={t.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-fg-muted">
                    <Landmark className="size-4" /> BANK · {DESTINATION_LABEL[t.destination]}
                  </span>
                  <span className="num font-medium">
                    {f.money(t.amountCents, { signed: true })}
                  </span>
                </p>
              ))}
              {detail.children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openBranch(c.id)}
                  className="flex items-center justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-2 text-fg-muted">
                    <GitFork className="size-4" /> Child{" "}
                    <span className="font-mono font-semibold text-fg">{c.code}</span>
                  </span>
                  <span className="num font-medium">{f.money(c.birthCapitalCents)}</span>
                </button>
              ))}
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader
            title="Protocol"
            description={
              bet.protocolStatus ? `Status: ${bet.protocolStatus}` : "No protocol status"
            }
          />
          <CardBody>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {CHECKLIST_ITEMS.map((item) => {
                const value = bet.checklist?.[item] ?? "UNKNOWN";
                return (
                  <li key={item} className="flex items-center justify-between gap-2">
                    <span className="text-fg-muted">{CHECKLIST_LABEL[item]}</span>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        value === "TRUE"
                          ? "text-good"
                          : value === "FALSE"
                            ? "text-critical"
                            : "text-fg-subtle",
                      )}
                    >
                      {value === "TRUE" ? "Yes" : value === "FALSE" ? "No" : "?"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {bet.confidence ? (
              <p className="mt-3 text-xs text-fg-subtle">Confidence {bet.confidence}/5</p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <EditTicketDialog detail={detail} open={dialog === "edit"} onClose={() => setDialog(null)} />
      <ReasonDialog
        open={dialog === "cancel"}
        title="Cancel pending ticket"
        description="Only for a ticket recorded by mistake. It stays in the journal as cancelled; the branch capital is untouched."
        confirmLabel="Cancel ticket"
        onClose={() => setDialog(null)}
        onConfirm={(reason) => cancelTicketAction({ betId: bet.id, reason })}
      />
      <ReasonDialog
        open={dialog === "revert"}
        title="Revert settlement"
        description="Puts the ticket back to pending and restores the branch exactly as before (journaled as MANUAL_ADJUSTMENT). Then settle it again with the right result."
        confirmLabel="Revert"
        onClose={() => setDialog(null)}
        onConfirm={(reason) => revertSettlementAction({ betId: bet.id, reason })}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd className={cn("mt-1 num font-medium", tone)}>{value}</dd>
      {sub ? <dd className="text-[11px] text-fg-subtle">{sub}</dd> : null}
    </div>
  );
}

function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const { notifyMutation } = useUi();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={title}
      description={description}
      size="sm"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await onConfirm(reason);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            toast.success("Done — journaled");
            notifyMutation();
            onClose();
          });
        }}
      >
        <Field label="Reason (journaled)" error={error}>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditTicketDialog({
  detail,
  open,
  onClose,
}: {
  detail: TicketDetailDTO;
  open: boolean;
  onClose: () => void;
}) {
  const { bet } = detail;
  const settled = bet.result !== "PENDING";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title="Edit ticket details"
      description={
        settled
          ? "This ticket is settled: identity edits are journaled. Stake, odds and result can never be edited here."
          : "Stake and odds cannot be edited — cancel and re-create the ticket if they are wrong."
      }
      size="md"
    >
      {open ? <EditTicketForm detail={detail} onDone={onClose} /> : null}
    </Dialog>
  );
}

function EditTicketForm({ detail, onDone }: { detail: TicketDetailDTO; onDone: () => void }) {
  const { bet } = detail;
  const { notifyMutation } = useUi();
  const [form, setForm] = useState({
    sport: bet.sport,
    competition: bet.competition,
    eventName: bet.eventName,
    marketName: bet.marketName,
    selection: bet.selection,
    eventDate: bet.eventDate,
    eventTime: bet.eventTime ?? "",
    closingOdds: bet.closingOddsBp ? formatOdds(bet.closingOddsBp) : "",
    protocolStatus: (bet.protocolStatus ?? "") as ProtocolStatus | "",
    confidence: bet.confidence ? String(bet.confidence) : "",
    notes: bet.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof form, value: string) => setForm((p) => ({ ...p, [key]: value }));

  function submit() {
    const closingOddsBp = form.closingOdds.trim() ? parseOdds(form.closingOdds) : undefined;
    if (form.closingOdds.trim() && closingOddsBp === null) {
      setError("Closing odds must be a decimal ≥ 1.01");
      return;
    }
    startTransition(async () => {
      const result = await updateTicketAction({
        betId: bet.id,
        sport: form.sport,
        competition: form.competition,
        eventName: form.eventName,
        marketName: form.marketName,
        selection: form.selection,
        eventDate: form.eventDate,
        eventTime: form.eventTime,
        closingOddsBp: closingOddsBp ?? undefined,
        protocolStatus: form.protocolStatus || undefined,
        confidence: form.confidence ? Number(form.confidence) : undefined,
        notes: form.notes,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Ticket updated");
      notifyMutation();
      onDone();
    });
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {(["sport", "competition", "eventName", "marketName", "selection"] as const).map((key) => (
        <Field
          key={key}
          label={
            {
              sport: "Sport",
              competition: "Competition",
              eventName: "Match",
              marketName: "Market",
              selection: "Selection",
            }[key]
          }
          className={key === "eventName" ? "sm:col-span-2" : undefined}
        >
          {(p) => <Input {...p} value={form[key]} onChange={(e) => set(key, e.target.value)} />}
        </Field>
      ))}
      <Field label="Match day">
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
      <Field label="Closing odds" hint="Used for CLV">
        {(p) => (
          <AmountInput
            {...p}
            value={form.closingOdds}
            placeholder="1.25"
            onChange={(e) => set("closingOdds", e.target.value)}
          />
        )}
      </Field>
      <Field label="Protocol status">
        {(p) => (
          <Select
            {...p}
            value={form.protocolStatus}
            onChange={(e) => set("protocolStatus", e.target.value)}
          >
            <option value="">—</option>
            {PROTOCOL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Confidence (1–5)">
        {(p) => (
          <Select
            {...p}
            value={form.confidence}
            onChange={(e) => set("confidence", e.target.value)}
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        {(p) => (
          <Textarea {...p} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        )}
      </Field>
      {error ? <p className="text-sm text-critical sm:col-span-2">{error}</p> : null}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
