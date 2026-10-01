"use client";

import { ArrowDownToLine, CalendarDays, Download, ShieldCheck, Undo2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BANK_DESTINATIONS, BANK_STATUSES, PROFILES, type BankDestination } from "@/domain/types";
import { MoneyAreaChart } from "@/components/charts/time-charts";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ProfileDot } from "@/components/ui/domain-badges";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { DESTINATION_LABEL, HARVEST_LABEL, PROFILE_COLOR_VAR, PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/dates";
import { withWorkspace } from "@/lib/workspace";
import type { BankDTO, BankFilters } from "@/server/queries/bank";
import type { BankTransactionDTO } from "@/server/queries/dto";
import {
  markWithdrawnAction,
  setBankDestinationAction,
  setWithdrawalDateAction,
  undoWithdrawnAction,
} from "@/server/actions/bank-actions";

export function BankView({ data, filters }: { data: BankDTO; filters: BankFilters }) {
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openBranch, notifyMutation, workspace } = useUi();
  const [pending, startTransition] = useTransition();
  const filtered = Boolean(
    filters.branch ||
    filters.profile ||
    filters.destination ||
    filters.status ||
    filters.from ||
    filters.to,
  );

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const setDestination = (transactionId: string, destination: BankDestination) =>
    startTransition(async () => {
      const result = await setBankDestinationAction(workspace, {
        transactionIds: [transactionId],
        destination,
      });
      if (result.ok) {
        toast.success(`Destination: ${DESTINATION_LABEL[destination]}`);
        notifyMutation();
      } else toast.error(result.message);
    });

  const [withdrawal, setWithdrawal] = useState<{
    mode: "mark" | "date";
    rows: BankTransactionDTO[];
  } | null>(null);

  const undoWithdrawn = (transactionIds: string[]) =>
    startTransition(async () => {
      const result = await undoWithdrawnAction(workspace, { transactionIds });
      if (result.ok) {
        toast.success("Withdrawal undone — the money is SECURED (still never playable)");
        notifyMutation();
      } else toast.error(result.message);
    });

  const awaiting = data.transactions.filter((t) => t.status === "SECURED");

  const maxBranch = Math.max(1, ...data.byBranch.map((b) => b.amountCents));
  const totalProfiles = Math.max(
    1,
    data.byProfile.reduce((s, p) => s + p.amountCents, 0),
  );

  return (
    <div className={cn("flex flex-col gap-5", pending && "opacity-90")}>
      <Card>
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-medium tracking-[0.16em] text-fg-muted uppercase">
              <ShieldCheck className="size-4" /> Total secured
            </p>
            <AnimatedNumber
              value={data.status.securedCents}
              format={(v) => f.money(v)}
              className="mt-2 block text-5xl font-semibold tracking-tight sm:text-6xl"
            />
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-subtle">Withdrawn</dt>
                <dd className="num font-semibold text-good" data-testid="bank-withdrawn">
                  {f.money(data.status.withdrawnCents)}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-subtle">Awaiting withdrawal</dt>
                <dd className="num font-semibold text-warning" data-testid="bank-awaiting">
                  {f.money(data.status.awaitingWithdrawalCents)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 max-w-lg text-sm text-fg-subtle">
              One-way: money secured here never returns to the branches and cannot revive a dead
              one. WITHDRAWN only records that it actually left Winamax.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            {(
              [
                ["Today", data.periods.today],
                ["7 days", data.periods.last7d],
                ["30 days", data.periods.last30d],
                ["All time", data.periods.allTime],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{f.money(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Cumulative BANK" />
          <CardBody>
            {data.series.length > 0 ? (
              <MoneyAreaChart
                name="BANK"
                data={data.series.map((p) => ({ day: p.day, value: p.cumulativeCents }))}
              />
            ) : (
              <EmptyState
                title="Nothing secured yet"
                description="BANK grows when a branch reaches P1, a threshold, or profits above its cap."
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Provenance by profile"
            description={filtered ? "Filtered view" : undefined}
          />
          <CardBody className="flex flex-col gap-4">
            <div
              className="flex h-3 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label="BANK share by profile"
            >
              {data.byProfile
                .filter((p) => p.amountCents > 0)
                .map((p) => (
                  <div
                    key={p.profile}
                    style={{ flex: p.amountCents, background: PROFILE_COLOR_VAR[p.profile] }}
                  />
                ))}
            </div>
            <ul className="flex flex-col gap-2 text-sm">
              {data.byProfile.map((p) => (
                <li key={p.profile} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: PROFILE_COLOR_VAR[p.profile] }}
                      aria-hidden
                    />
                    {PROFILE_LABEL[p.profile]}
                    <span className="text-xs text-fg-subtle">{p.count} transfers</span>
                  </span>
                  <span className="num">
                    {f.money(p.amountCents)}{" "}
                    <span className="text-xs text-fg-subtle">
                      {f.ratio(p.amountCents / totalProfiles, 0)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-medium tracking-wider text-fg-subtle uppercase">
                Destination
              </p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {data.byDestination
                  .filter((d) => d.amountCents > 0)
                  .map((d) => (
                    <li key={d.destination} className="flex justify-between">
                      <span className="text-fg-muted">{DESTINATION_LABEL[d.destination]}</span>
                      <span className="num">{f.money(d.amountCents)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="BANK history"
            description="Every contribution, newest first"
            action={
              <Button variant="ghost" size="sm" asChild>
                <a href={withWorkspace("/api/export/csv/bank", workspace)} download>
                  <Download /> CSV
                </a>
              </Button>
            }
          />
          <div className="flex flex-wrap items-end gap-2 border-y border-border px-5 py-3">
            <Select
              aria-label="Branch"
              className="h-8 w-28 text-xs"
              value={filters.branch ?? ""}
              onChange={(e) => update("branch", e.target.value)}
            >
              <option value="">All branches</option>
              {data.branchCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Profile"
              className="h-8 w-32 text-xs"
              value={filters.profile ?? ""}
              onChange={(e) => update("profile", e.target.value)}
            >
              <option value="">All profiles</option>
              {PROFILES.map((p) => (
                <option key={p} value={p}>
                  {PROFILE_LABEL[p]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Destination"
              className="h-8 w-36 text-xs"
              value={filters.destination ?? ""}
              onChange={(e) => update("destination", e.target.value)}
            >
              <option value="">All destinations</option>
              {BANK_DESTINATIONS.map((d) => (
                <option key={d} value={d}>
                  {DESTINATION_LABEL[d]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Status"
              className="h-8 w-32 text-xs"
              value={filters.status ?? ""}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">All statuses</option>
              {BANK_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Select>
            <Input
              aria-label="From"
              type="date"
              className="h-8 w-36 text-xs"
              value={filters.from ?? ""}
              onChange={(e) => update("from", e.target.value)}
            />
            <Input
              aria-label="To"
              type="date"
              className="h-8 w-36 text-xs"
              value={filters.to ?? ""}
              onChange={(e) => update("to", e.target.value)}
            />
            {filtered ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
              >
                <X /> Clear
              </Button>
            ) : null}
            <span className="ml-auto flex items-center gap-3">
              {awaiting.length > 0 ? (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => setWithdrawal({ mode: "mark", rows: awaiting })}
                >
                  <ArrowDownToLine /> Mark {filtered ? "filtered" : "all"} as withdrawn
                </Button>
              ) : null}
              <span className="num text-sm text-fg-muted">{f.money(data.filteredTotalCents)}</span>
            </span>
          </div>
          {data.transactions.length === 0 ? (
            <EmptyState
              title="No BANK transfer"
              description={filtered ? "No transfer matches these filters." : "Nothing secured yet."}
            />
          ) : (
            <ol className="divide-y divide-border">
              {data.transactions.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => openBranch(t.branchId)}
                    className="flex w-20 items-center gap-1.5 font-mono font-semibold"
                  >
                    <ProfileDot profile={t.profile} />
                    {t.branchCode}
                  </button>
                  <span className="w-28 num text-base font-semibold">
                    {f.money(t.amountCents, { signed: true })}
                  </span>
                  <div className="min-w-48 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          t.type === "MATURE_PROFIT"
                            ? "mature"
                            : t.type === "MANUAL"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {t.harvestKind ? HARVEST_LABEL[t.harvestKind] : "Manual"}
                      </Badge>
                      <span className="truncate text-fg-muted">
                        {t.roundNumber
                          ? `${f.round(t.roundNumber)} · ${t.eventName}`
                          : (t.notes ?? "")}
                      </span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                      {f.dateTime(t.createdAt)}
                      {t.status === "WITHDRAWN" ? (
                        <Badge tone="good" data-testid="withdrawn-badge">
                          WITHDRAWN{t.withdrawnAt ? ` on ${f.date(t.withdrawnAt)}` : ""}
                        </Badge>
                      ) : (
                        <Badge tone="warning">SECURED · on Winamax</Badge>
                      )}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    {t.status === "SECURED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => setWithdrawal({ mode: "mark", rows: [t] })}
                      >
                        <ArrowDownToLine /> Mark as withdrawn
                      </Button>
                    ) : (
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setWithdrawal({ mode: "date", rows: [t] })}
                          aria-label={`Change the withdrawal date of the ${t.branchCode} entry`}
                        >
                          <CalendarDays /> Date
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => undoWithdrawn([t.id])}
                        >
                          <Undo2 /> Undo withdrawn
                        </Button>
                      </span>
                    )}
                    <Select
                      aria-label={`Destination of ${t.branchCode} transfer`}
                      className="h-8 w-36 text-xs"
                      value={t.destination}
                      onChange={(e) => setDestination(t.id, e.target.value as BankDestination)}
                    >
                      {BANK_DESTINATIONS.map((d) => (
                        <option key={d} value={d}>
                          {DESTINATION_LABEL[d]}
                        </option>
                      ))}
                    </Select>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardHeader title="Provenance by branch" />
          <CardBody>
            <ul className="flex flex-col gap-3">
              {data.byBranch.map((b) => (
                <li key={b.branchId}>
                  <button
                    type="button"
                    onClick={() => openBranch(b.branchId)}
                    className="w-full text-left"
                  >
                    <span className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-1.5 font-mono font-semibold">
                        <ProfileDot profile={b.profile} />
                        {b.code}
                      </span>
                      <span className="num">{f.money(b.amountCents)}</span>
                    </span>
                    <span className="block h-1.5 rounded-full bg-surface-3">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(b.amountCents / maxBranch) * 100}%`,
                          background: PROFILE_COLOR_VAR[b.profile],
                        }}
                      />
                    </span>
                  </button>
                </li>
              ))}
              {data.byBranch.length === 0 ? <li className="text-sm text-fg-subtle">—</li> : null}
            </ul>
          </CardBody>
        </Card>
      </div>
      {withdrawal ? (
        <WithdrawalDialog
          key={`${withdrawal.mode}-${withdrawal.rows.map((r) => r.id).join(",")}`}
          mode={withdrawal.mode}
          rows={withdrawal.rows}
          onClose={() => setWithdrawal(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * "Mark as withdrawn" / "Change withdrawal date": the withdrawal day defaults to today, may be
 * any past day since the money was secured, never a future day.
 */
function WithdrawalDialog({
  mode,
  rows,
  onClose,
}: {
  mode: "mark" | "date";
  rows: BankTransactionDTO[];
  onClose: () => void;
}) {
  const f = useFormat();
  const { workspace, notifyMutation } = useUi();
  const today = todayIso();
  const initial = mode === "date" && rows[0]?.withdrawnAt ? isoDay(rows[0].withdrawnAt) : today;
  const [day, setDay] = useState(initial);
  const [destination, setDestination] = useState<BankDestination | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const earliest = rows.reduce((min, t) => Math.min(min, t.createdAt), Infinity);
  const minDay = Number.isFinite(earliest) ? isoDay(earliest) : undefined;
  const total = rows.reduce((s, t) => s + t.amountCents, 0);

  const submit = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError("Choose a valid date");
    if (day > today) return setError("The withdrawal date cannot be in the future");
    if (minDay && day < minDay)
      return setError("The withdrawal date cannot be before the money was secured");
    startTransition(async () => {
      const ids = rows.map((r) => r.id);
      const result =
        mode === "mark"
          ? await markWithdrawnAction(workspace, {
              transactionIds: ids,
              withdrawnOn: day,
              destination: destination || undefined,
            })
          : await setWithdrawalDateAction(workspace, { transactionIds: ids, withdrawnOn: day });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(
        mode === "mark"
          ? `${result.data} entr${result.data === 1 ? "y" : "ies"} marked as withdrawn on ${f.day(day)}`
          : `Withdrawal date set to ${f.day(day)}`,
      );
      notifyMutation();
      onClose();
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={mode === "mark" ? "Mark as withdrawn" : "Change withdrawal date"}
      description={`${rows.length} BANK entr${rows.length === 1 ? "y" : "ies"} · ${f.money(total)}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={pending}
            data-testid="confirm-withdrawal"
          >
            {mode === "mark" ? "Mark as withdrawn" : "Save date"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Withdrawal date"
          error={error}
          hint="Defaults to today. A past date is fine; a future date is not."
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={day}
              max={today}
              min={minDay}
              onChange={(e) => {
                setDay(e.target.value);
                setError(null);
              }}
              data-testid="withdrawal-date"
            />
          )}
        </Field>
        {mode === "mark" ? (
          <Field label="Destination (optional)">
            {(p) => (
              <Select
                {...p}
                value={destination}
                onChange={(e) => setDestination(e.target.value as BankDestination | "")}
              >
                <option value="">Keep current destination</option>
                {BANK_DESTINATIONS.map((d) => (
                  <option key={d} value={d}>
                    {DESTINATION_LABEL[d]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <p className="text-xs text-fg-subtle">
          WITHDRAWN only records that the money left Winamax; it never returns to a branch. The
          change is snapshotted first and can be undone.
        </p>
      </div>
    </Dialog>
  );
}

/** Local calendar day (YYYY-MM-DD) of a timestamp. */
function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
