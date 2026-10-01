"use client";

import { Archive, ArchiveRestore, Pencil, Plus, Ticket, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatOdds, parseOdds } from "@/domain/money";
import {
  BET_RESULTS,
  CANDIDATE_STATUSES,
  type BetResult,
  type CandidateStatus,
  type Checklist,
} from "@/domain/types";
import type { TicketGroupStats } from "@/domain/analytics/stats";
import { ChecklistEditor } from "@/components/tickets/checklist-editor";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { AmountInput } from "@/components/ui/amount-input";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ResultBadge } from "@/components/ui/domain-badges";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { todayIso } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { CandidateDTO } from "@/server/queries/dto";
import {
  deleteCandidateAction,
  unarchiveCandidateAction,
} from "@/server/actions/correction-actions";
import { createCandidateAction, updateCandidateAction } from "@/server/actions/candidate-actions";

const STATUS_TONE: Record<CandidateStatus, BadgeTone> = {
  ELIGIBLE: "good",
  WATCH: "info",
  REJECTED: "critical",
};

export function CandidatesView({
  candidates,
  archived,
  stats,
}: {
  candidates: CandidateDTO[];
  archived: CandidateDTO[];
  stats: (TicketGroupStats & { status: CandidateStatus })[];
}) {
  const f = useFormat();
  const { openNewTicket } = useUi();
  const [filter, setFilter] = useState<CandidateStatus | "ALL">("ALL");
  const [editing, setEditing] = useState<CandidateDTO | "new" | null>(null);
  const rows = candidates.filter((c) => filter === "ALL" || c.protocolStatus === filter);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.status} className="card px-4 py-3.5">
            <div className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
              <span className="num text-xs text-fg-subtle">{s.tickets} analysed</span>
            </div>
            <p className="mt-2 text-xl font-semibold">
              {s.winRate === null ? "—" : f.ratio(s.winRate)}
            </p>
            <p className="text-[11px] text-fg-subtle">
              win rate on {s.decided} decided · break-even{" "}
              {s.breakEven === null ? "—" : f.ratio(s.breakEven)}
            </p>
            <p className="mt-1 text-[11px] text-fg-subtle">
              flat-stake yield {s.yield === null ? "—" : f.ratio(s.yield)} · CLV{" "}
              {s.avgClvBp === null ? "—" : f.pct(s.avgClvBp, 1, true)}
              {s.significant ? "" : " · small sample"}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Filter by status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "ALL", label: "All" },
            ...CANDIDATE_STATUSES.map((s) => ({
              value: s,
              label: s.charAt(0) + s.slice(1).toLowerCase(),
            })),
          ]}
        />
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus /> Add candidate
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No candidate"
            description="Record matches you analysed but did not play to build statistics without staking money."
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border text-left text-[11px] tracking-wider text-fg-subtle uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Match · selection</th>
                <th className="px-3 py-2.5 text-right font-medium">Odds</th>
                <th className="px-3 py-2.5 text-right font-medium">Closing</th>
                <th className="px-3 py-2.5 text-right font-medium">CLV</th>
                <th className="px-3 py-2.5 font-medium">Protocol</th>
                <th className="px-3 py-2.5 font-medium">Result</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 num whitespace-nowrap text-fg-muted">
                    {f.day(c.eventDate)}
                  </td>
                  <td className="max-w-xs px-3 py-2.5">
                    <p className="truncate">{c.eventName}</p>
                    <p className="truncate text-xs text-fg-subtle">
                      {c.selection} · {c.sport} · {c.competition}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right num">{f.odds(c.oddsObservedBp)}</td>
                  <td className="px-3 py-2.5 text-right num text-fg-muted">
                    {c.closingOddsBp ? f.odds(c.closingOddsBp) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right num",
                      (c.clvBp ?? 0) > 0 ? "text-good" : "text-fg-muted",
                    )}
                  >
                    {c.clvBp === null ? "—" : f.pct(c.clvBp, 1, true)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={STATUS_TONE[c.protocolStatus]}>{c.protocolStatus}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <ResultBadge result={c.result} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Play as a ticket"
                        title={c.convertedBetId ? "Already played" : "Play as a ticket"}
                        disabled={Boolean(c.convertedBetId)}
                        onClick={() =>
                          openNewTicket({
                            candidateId: c.id,
                            prefill: {
                              sport: c.sport,
                              competition: c.competition,
                              eventName: c.eventName,
                              marketName: c.marketName,
                              selection: c.selection,
                              oddsBp: c.oddsObservedBp,
                              eventDate: c.eventDate,
                              eventTime: c.eventTime ?? undefined,
                              checklist: c.checklist ?? undefined,
                            },
                          })
                        }
                      >
                        <Ticket />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit candidate"
                        onClick={() => setEditing(c)}
                      >
                        <Pencil />
                      </Button>
                      <ArchiveButton id={c.id} label={`${c.eventName} · ${c.selection}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => (!o ? setEditing(null) : undefined)}
        title={editing === "new" ? "Add candidate" : "Edit candidate"}
        description="Shadow portfolio — analysed, not played. One candidate = one single match."
        size="lg"
      >
        {editing ? (
          <CandidateForm
            candidate={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
      {archived.length > 0 ? <ArchivedCandidates archived={archived} /> : null}
    </div>
  );
}

/** Archived candidates, each with an explicit (confirmed, audited, undoable) Unarchive. */
function ArchivedCandidates({ archived }: { archived: CandidateDTO[] }) {
  const f = useFormat();
  const { notifyMutation, workspace } = useUi();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<CandidateDTO | null>(null);
  const confirm = () =>
    startTransition(async () => {
      if (!target) return;
      const result = await unarchiveCandidateAction(workspace, { id: target.id });
      if (result.ok) {
        toast.success(`Unarchived candidate ${result.data}`);
        setTarget(null);
        notifyMutation();
      } else toast.error(result.message);
    });
  return (
    <Card>
      <details>
        <summary className="cursor-pointer px-4 py-3 text-sm text-fg-muted select-none">
          Archived candidates ({archived.length})
        </summary>
        <ul className="divide-y divide-border border-t border-border">
          {archived.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{c.eventName}</span>
                <span className="text-xs text-fg-subtle">
                  {f.day(c.eventDate)} · {c.selection} @{f.odds(c.oddsObservedBp)} ·{" "}
                  {c.protocolStatus}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setTarget(c)} disabled={pending}>
                <ArchiveRestore /> Unarchive
              </Button>
            </li>
          ))}
        </ul>
      </details>
      <Dialog
        open={target !== null}
        onOpenChange={(open) => (!open ? setTarget(null) : undefined)}
        title="Unarchive candidate?"
        description={target ? `${target.eventName} · ${target.selection}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={pending}>
              Unarchive
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          The candidate returns to the shadow portfolio and its statistics. A snapshot is taken
          first, so this can be undone.
        </p>
      </Dialog>
    </Card>
  );
}

function ArchiveButton({ id, label }: { id: string; label: string }) {
  const { notifyMutation, workspace } = useUi();
  const [pending, startTransition] = useTransition();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const remove = (mode: "ARCHIVE" | "PURGE") =>
    startTransition(async () => {
      const result = await deleteCandidateAction(workspace, {
        id,
        mode,
        confirmation: mode === "PURGE" ? typed : undefined,
      });
      if (result.ok) {
        toast.success(result.data);
        setPurgeOpen(false);
        notifyMutation();
      } else toast.error(result.message);
    });
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Archive candidate"
        title="Archive (kept in the file, hidden from lists)"
        disabled={pending}
        onClick={() => remove("ARCHIVE")}
      >
        <Archive />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete candidate permanently"
        title="Delete permanently"
        disabled={pending}
        onClick={() => setPurgeOpen(true)}
      >
        <Trash2 />
      </Button>
      <Dialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Delete candidate permanently?"
        description={label}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurgeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending || typed !== "DELETE"}
              onClick={() => remove("PURGE")}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          A snapshot is taken first. Type <strong className="font-mono text-fg">DELETE</strong> to
          confirm.
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="font-mono"
            autoComplete="off"
          />
        </label>
      </Dialog>
    </>
  );
}

function CandidateForm({
  candidate,
  onDone,
}: {
  candidate: CandidateDTO | null;
  onDone: () => void;
}) {
  const { notifyMutation, workspace } = useUi();
  const [form, setForm] = useState({
    eventDate: candidate?.eventDate ?? todayIso(),
    eventTime: candidate?.eventTime ?? "",
    sport: candidate?.sport ?? "Football",
    competition: candidate?.competition ?? "",
    eventName: candidate?.eventName ?? "",
    marketName: candidate?.marketName ?? "Vainqueur du match",
    selection: candidate?.selection ?? "",
    odds: candidate ? formatOdds(candidate.oddsObservedBp) : "",
    closing: candidate?.closingOddsBp ? formatOdds(candidate.closingOddsBp) : "",
    protocolStatus: candidate?.protocolStatus ?? ("WATCH" as CandidateStatus),
    result: candidate?.result ?? ("PENDING" as BetResult),
    notes: candidate?.notes ?? "",
  });
  const [checklist, setChecklist] = useState<Checklist>(
    candidate?.checklist ?? { singleMatch: "TRUE" },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof form, value: string) => setForm((p) => ({ ...p, [key]: value }));

  function submit() {
    const oddsObservedBp = parseOdds(form.odds);
    const closingOddsBp = form.closing.trim() ? parseOdds(form.closing) : null;
    if (oddsObservedBp === null || (form.closing.trim() && closingOddsBp === null)) {
      setError("Odds must be decimals ≥ 1.01");
      return;
    }
    const payload = {
      eventDate: form.eventDate,
      eventTime: form.eventTime,
      sport: form.sport,
      competition: form.competition,
      eventName: form.eventName,
      marketName: form.marketName,
      selection: form.selection,
      oddsObservedBp,
      closingOddsBp,
      protocolStatus: form.protocolStatus,
      result: form.result,
      checklist: { ...checklist, singleMatch: "TRUE" as const },
      notes: form.notes,
    };
    startTransition(async () => {
      const result = candidate
        ? await updateCandidateAction(workspace, { id: candidate.id, ...payload })
        : await createCandidateAction(workspace, payload);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(candidate ? "Candidate updated" : "Candidate added");
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
      <Field label="Match" className="sm:col-span-2">
        {(p) => (
          <Input
            {...p}
            value={form.eventName}
            placeholder="Real Madrid - Getafe"
            onChange={(e) => set("eventName", e.target.value)}
          />
        )}
      </Field>
      <Field label="Sport">
        {(p) => <Input {...p} value={form.sport} onChange={(e) => set("sport", e.target.value)} />}
      </Field>
      <Field label="Competition">
        {(p) => (
          <Input
            {...p}
            value={form.competition}
            onChange={(e) => set("competition", e.target.value)}
          />
        )}
      </Field>
      <Field label="Market">
        {(p) => (
          <Input
            {...p}
            value={form.marketName}
            onChange={(e) => set("marketName", e.target.value)}
          />
        )}
      </Field>
      <Field label="Selection">
        {(p) => (
          <Input {...p} value={form.selection} onChange={(e) => set("selection", e.target.value)} />
        )}
      </Field>
      <Field label="Odds observed">
        {(p) => (
          <AmountInput
            {...p}
            value={form.odds}
            placeholder="1.25"
            onChange={(e) => set("odds", e.target.value)}
          />
        )}
      </Field>
      <Field label="Closing odds">
        {(p) => (
          <AmountInput
            {...p}
            value={form.closing}
            onChange={(e) => set("closing", e.target.value)}
          />
        )}
      </Field>
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
      <Field label="Protocol status">
        {(p) => (
          <Select
            {...p}
            value={form.protocolStatus}
            onChange={(e) => set("protocolStatus", e.target.value)}
          >
            {CANDIDATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Result">
        {(p) => (
          <Select {...p} value={form.result} onChange={(e) => set("result", e.target.value)}>
            {BET_RESULTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-[13px] font-medium text-fg-muted">
          Protocol checklist (why it was eligible or not)
        </p>
        <ChecklistEditor value={checklist} onChange={setChecklist} />
      </div>
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
