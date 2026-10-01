"use client";

import {
  CircleCheck,
  CircleAlert,
  ExternalLink,
  Landmark,
  ListTree,
  MoreHorizontal,
  NotebookPen,
  Pause,
  PenLine,
  Play,
  Plus,
  Scale,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { isPlayable } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { ProfileBadge, ProfileDot, ResultBadge, StatusBadge } from "@/components/ui/domain-badges";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Progress } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EVENT_LABEL, HARVEST_LABEL, PROFILE_COLOR_VAR } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { BetDTO, BranchDetailDTO, BranchEventDTO } from "@/server/queries/dto";
import { BranchActionDialogs, type BranchDialogKind } from "./branch-action-dialogs";
import { EventIcon } from "./event-icon";
import { ANNEX_TYPES, buildRoundTimeline } from "./timeline";

type TabId = "overview" | "rounds" | "events" | "children" | "stats";

export function BranchDetailView({
  detail,
  variant = "drawer",
}: {
  detail: BranchDetailDTO;
  variant?: "drawer" | "page";
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [dialog, setDialog] = useState<BranchDialogKind>(null);
  const { branch } = detail;

  return (
    <div className="flex flex-col">
      <BranchHeader
        detail={detail}
        variant={variant}
        onDialog={setDialog}
        onAudit={() => setTab("events")}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList aria-label="Branch sections" className={variant === "page" ? "px-0" : undefined}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rounds">
            Rounds · {detail.bets.filter((b) => !b.cancelledAt).length}
          </TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="children">Children · {detail.children.length}</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
        </TabsList>
        <div className={variant === "page" ? "py-5" : "px-5 py-5"}>
          <TabsContent value="overview">
            <OverviewTab detail={detail} />
          </TabsContent>
          <TabsContent value="rounds">
            <RoundsTab detail={detail} />
          </TabsContent>
          <TabsContent value="events">
            <EventsTab detail={detail} />
          </TabsContent>
          <TabsContent value="children">
            <ChildrenTab detail={detail} />
          </TabsContent>
          <TabsContent value="stats">
            <StatsTab detail={detail} />
          </TabsContent>
        </div>
      </Tabs>
      <BranchActionDialogs branch={branch} kind={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function BranchHeader({
  detail,
  variant,
  onDialog,
  onAudit,
}: {
  detail: BranchDetailDTO;
  variant: "drawer" | "page";
  onDialog: (kind: BranchDialogKind) => void;
  onAudit: () => void;
}) {
  const f = useFormat();
  const { openNewTicket, openSettle, openBranch } = useUi();
  const { branch, parent } = detail;
  const dead = branch.status === "DEAD";
  const capRatio = branch.capCents > 0 ? branch.currentCapitalCents / branch.capCents : 0;

  return (
    <div className={cn("flex flex-col gap-4", variant === "drawer" ? "px-5 pt-5 pb-4" : "pb-5")}>
      <div className="flex flex-wrap items-center gap-2 pr-8">
        <span
          className="flex size-9 items-center justify-center rounded-xl border border-border"
          style={{
            background: `color-mix(in oklab, ${PROFILE_COLOR_VAR[branch.profile]} 18%, transparent)`,
          }}
        >
          <ProfileDot profile={branch.profile} className="size-3" />
        </span>
        <h2 className="font-mono text-2xl font-semibold tracking-tight">{branch.code}</h2>
        <ProfileBadge profile={branch.profile} />
        <StatusBadge status={branch.status} />
        <span className="text-xs text-fg-subtle">Gen {branch.generation}</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <button
          type="button"
          onClick={onAudit}
          className="group text-left"
          title="Explain this amount"
        >
          <p className="text-[11px] tracking-wider text-fg-subtle uppercase">Current capital</p>
          <p
            className={cn(
              "num text-3xl font-semibold tracking-tight",
              dead && "text-fg-subtle line-through decoration-1",
            )}
          >
            {f.money(branch.currentCapitalCents)}
          </p>
          <p className="text-xs text-fg-subtle group-hover:text-fg-muted">
            {detail.ledger.balanced
              ? "Explained by the event log →"
              : "Ledger mismatch — open audit →"}
          </p>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {detail.pendingBetId ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => openSettle(detail.pendingBetId as string)}
            >
              <Scale /> Settle {f.round(branch.roundCount + 1)}
            </Button>
          ) : isPlayable(branch.status) ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => openNewTicket({ branchId: branch.id })}
            >
              <Plus /> New round
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/branches/${encodeURIComponent(branch.code)}/lineage`}>
              <ListTree /> Lineage
            </Link>
          </Button>
          {variant === "drawer" ? (
            <Button variant="ghost" size="icon-sm" asChild aria-label="Open full page">
              <Link href={`/branches/${encodeURIComponent(branch.code)}`}>
                <ExternalLink />
              </Link>
            </Button>
          ) : null}
          {!dead ? (
            <Menu
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              }
            >
              <MenuItem onSelect={() => onDialog("pause")} disabled={Boolean(detail.pendingBetId)}>
                {branch.status === "PAUSED" ? <Play /> : <Pause />}
                {branch.status === "PAUSED" ? "Resume branch" : "Pause branch"}
              </MenuItem>
              <MenuItem onSelect={() => onDialog("bank")} disabled={Boolean(detail.pendingBetId)}>
                <Landmark /> Secure to BANK…
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => onDialog("adjust")} disabled={Boolean(detail.pendingBetId)}>
                <PenLine /> Manual adjustment…
              </MenuItem>
              <MenuItem onSelect={() => onDialog("notes")}>
                <NotebookPen /> Edit notes…
              </MenuItem>
              <MenuItem onSelect={() => onDialog("profile")}>
                <Tag /> Change profile (exceptional)…
              </MenuItem>
            </Menu>
          ) : null}
        </div>
      </div>

      {!dead ? (
        <div className="flex items-center gap-3">
          <Progress
            value={capRatio}
            color={PROFILE_COLOR_VAR[branch.profile]}
            label="Capital vs cap"
          />
          <span className="shrink-0 num text-xs text-fg-subtle">
            cap {f.money(branch.capCents, { trimZeroCents: true })}
          </span>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-surface-2 p-4 text-sm sm:grid-cols-3">
        <Fact label="Birth capital" value={f.money(branch.birthCapitalCents)} />
        <Fact label="Born" value={f.date(branch.createdAt)} />
        <Fact
          label="Parent"
          value={
            parent ? (
              <button
                type="button"
                className="font-mono font-medium hover:underline"
                onClick={() => openBranch(parent.id)}
              >
                {parent.code}
              </button>
            ) : (
              "Root"
            )
          }
        />
        <Fact label="BANK produced" value={f.money(branch.totalBankGeneratedCents)} />
        <Fact label="Children" value={String(branch.childCount)} />
        <Fact
          label={`${f.roundLabel}s`}
          value={`${f.round(branch.roundCount)}${branch.voids ? ` · ${branch.voids} void` : ""}`}
        />
      </dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 truncate num text-fg">{value}</dd>
    </div>
  );
}

function OverviewTab({ detail }: { detail: BranchDetailDTO }) {
  const f = useFormat();
  const { branch, milestone } = detail;
  const birthEvent = detail.events.find((e) => e.type === "BIRTH");
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border p-4">
        <p className="text-[11px] tracking-wider text-fg-subtle uppercase">Next milestone</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="text-lg font-semibold">{milestone.label}</p>
          {milestone.kind !== "NONE" ? (
            <p className="num text-sm text-fg-muted">
              {f.money(branch.currentCapitalCents)} / {f.money(milestone.thresholdCents)}
            </p>
          ) : null}
        </div>
        {milestone.kind !== "NONE" ? (
          <Progress
            value={milestone.progress}
            className="mt-2"
            color={PROFILE_COLOR_VAR[branch.profile]}
            label="Progress to milestone"
          />
        ) : null}
        <p className="mt-2 text-sm text-fg-muted">{milestone.detail}</p>
      </section>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Kv label="Status" value={<StatusBadge status={branch.status} />} />
        <Kv label="Profile" value={<ProfileBadge profile={branch.profile} />} />
        <Kv label="Generation" value={String(branch.generation)} />
        <Kv label="Cap" value={f.money(branch.capCents)} />
        <Kv label="Lifetime generated" value={f.money(branch.ltvCents)} />
        <Kv
          label="Capital sent to children"
          value={f.money(branch.totalChildCapitalGeneratedCents)}
        />
        {branch.maturedAt ? <Kv label="Matured" value={f.dateTime(branch.maturedAt)} /> : null}
        {branch.diedAt ? <Kv label="Died" value={f.dateTime(branch.diedAt)} /> : null}
        {branch.status === "DEAD" ? (
          <Kv label="Capital lost" value={f.money(branch.totalLostCents)} />
        ) : null}
      </dl>

      {birthEvent ? (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          <EventIcon type="BIRTH" className="mt-0.5" />
          {birthEvent.description}
        </p>
      ) : null}
      {detail.branch.notes ? (
        <p className="rounded-lg border border-border px-3 py-2 text-sm whitespace-pre-wrap text-fg-muted">
          {detail.branch.notes}
        </p>
      ) : null}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
      <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd className="num text-fg">{value}</dd>
    </div>
  );
}

function RoundsTab({ detail }: { detail: BranchDetailDTO }) {
  const items = buildRoundTimeline(detail.bets, detail.events);
  if (detail.bets.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <TimelineEvents events={detail.events} />
        <p className="text-sm text-fg-subtle">
          No round played yet. No-bet days are perfectly fine.
        </p>
      </div>
    );
  }
  return (
    <ol className="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-border">
      {items.map((item) =>
        item.kind === "bet" ? (
          <RoundCard key={item.bet.id} bet={item.bet} events={item.events} />
        ) : (
          <li key={item.event.id} className="relative flex items-start gap-3 pl-0.5">
            <span className="z-10 flex size-[22px] items-center justify-center rounded-full border border-border bg-surface">
              <EventIcon type={item.event.type} className="size-3.5" />
            </span>
            <p className="pt-0.5 text-sm text-fg-muted">{item.event.description}</p>
          </li>
        ),
      )}
    </ol>
  );
}

function TimelineEvents({ events }: { events: BranchEventDTO[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-sm text-fg-muted">
          <EventIcon type={e.type} className="mt-0.5" />
          {e.description}
        </li>
      ))}
    </ul>
  );
}

function RoundCard({ bet, events }: { bet: BetDTO; events: BranchEventDTO[] }) {
  const f = useFormat();
  const { openSettle } = useUi();
  const annex = events.filter((e) => ANNEX_TYPES.has(e.type) && e.type !== "SPLIT");
  const split = events.find((e) => e.type === "SPLIT");
  const resultTone = bet.cancelledAt
    ? "border-border"
    : bet.result === "WON"
      ? "border-good/40"
      : bet.result === "LOST"
        ? "border-critical/40"
        : "border-border";
  return (
    <li className="relative flex items-start gap-3">
      <span
        className={cn(
          "z-10 mt-3 flex size-[22px] shrink-0 items-center justify-center rounded-full border bg-surface font-mono text-[10px] font-semibold",
          resultTone,
        )}
      >
        {bet.cancelledAt ? "×" : bet.roundNumber}
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-xl border bg-surface-2 p-3.5",
          resultTone,
          bet.cancelledAt && "opacity-60",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {f.round(bet.roundNumber)}{" "}
            <span className="font-normal text-fg-subtle">· {f.day(bet.eventDate)}</span>
          </p>
          <ResultBadge result={bet.result} cancelled={Boolean(bet.cancelledAt)} />
        </div>
        <p className="mt-1 truncate text-sm text-fg">{bet.eventName}</p>
        <p className="truncate text-xs text-fg-subtle">
          {bet.marketName} · {bet.selection}
        </p>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
          <Mini label="Odds" value={f.odds(bet.oddsBp)} />
          <Mini label="Stake" value={f.money(bet.stakeCents)} />
          <Mini label="Before" value={f.money(bet.capitalBeforeCents)} />
          <Mini
            label={bet.result === "PENDING" ? "Potential" : "After"}
            value={f.money(
              bet.result === "PENDING" ? bet.potentialReturnCents : (bet.capitalAfterCents ?? 0),
            )}
            strong
          />
        </dl>
        {bet.result === "PENDING" && !bet.cancelledAt ? (
          <Button size="sm" variant="primary" className="mt-3" onClick={() => openSettle(bet.id)}>
            <Scale /> Settle ticket
          </Button>
        ) : null}
        {annex.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
            {annex.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[13px] text-fg-muted">
                <EventIcon type={e.type} className="mt-0.5 size-3.5" />
                <span className="min-w-0">
                  {e.type === "HARVEST" && typeof e.metadata?.kind === "string" ? (
                    <span className="mr-1 font-medium text-fg">
                      {HARVEST_LABEL[e.metadata.kind as "P1"]}
                    </span>
                  ) : null}
                  {e.description}
                </span>
              </li>
            ))}
            {split ? (
              <li className="flex items-start gap-2 text-[13px] font-medium text-fg">
                <EventIcon type="SPLIT" className="mt-0.5 size-3.5" />
                {split.description}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function Mini({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd className={cn("truncate num text-fg-muted", strong && "font-semibold text-fg")}>
        {value}
      </dd>
    </div>
  );
}

function EventsTab({ detail }: { detail: BranchDetailDTO }) {
  const f = useFormat();
  const { ledger } = detail;
  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
          ledger.balanced ? "border-good/30 bg-good/5" : "border-critical/40 bg-critical/5",
        )}
      >
        {ledger.balanced ? (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-critical" />
        )}
        <p className="text-fg-muted">
          {ledger.balanced ? "Ledger balanced: " : "Ledger mismatch: "}Σ capital deltas ={" "}
          <span className="num text-fg">{f.money(ledger.reconstructedCents)}</span>, stored capital
          = <span className="num text-fg">{f.money(ledger.storedCents)}</span>.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-surface-2 text-left text-[11px] tracking-wider text-fg-subtle uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 text-right font-medium">Δ capital</th>
              <th className="px-3 py-2 text-right font-medium">Capital</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {detail.events.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-3 py-2 num text-xs text-fg-subtle">{e.id}</td>
                <td className="px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                    <EventIcon type={e.type} className="size-3.5" />
                    {EVENT_LABEL[e.type]}
                    <span className="font-normal text-fg-subtle">· {f.dateTime(e.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-fg-muted">{e.description}</p>
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right num whitespace-nowrap",
                    e.capitalDeltaCents > 0
                      ? "text-good"
                      : e.capitalDeltaCents < 0
                        ? "text-fg"
                        : "text-fg-subtle",
                  )}
                >
                  {e.capitalDeltaCents === 0 ? "—" : f.money(e.capitalDeltaCents, { signed: true })}
                </td>
                <td className="px-3 py-2 text-right num whitespace-nowrap text-fg-muted">
                  {e.capitalAfterCents !== null ? f.money(e.capitalAfterCents) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChildrenTab({ detail }: { detail: BranchDetailDTO }) {
  const f = useFormat();
  const { openBranch } = useUi();
  if (detail.children.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">
        No child branch yet. Children are created by harvests (P1, thresholds, mature profit).
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {detail.children.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => openBranch(c.id)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-left hover:border-border-strong",
              c.status === "DEAD" && "opacity-70",
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ProfileDot profile={c.profile} className="size-2.5" />
              <span className="font-mono text-sm font-semibold">{c.code}</span>
              <StatusBadge status={c.status} />
              <span className="truncate text-xs text-fg-subtle">
                via {HARVEST_LABEL[c.birthReason as "P1"] ?? c.birthReason} · {f.date(c.createdAt)}
              </span>
            </span>
            <span className="text-right">
              <span className="block num text-sm">{f.money(c.currentCapitalCents)}</span>
              <span className="block num text-[11px] text-fg-subtle">
                born {f.money(c.birthCapitalCents)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatsTab({ detail }: { detail: BranchDetailDTO }) {
  const f = useFormat();
  const { branch, stats } = detail;
  const items: [string, string][] = [
    ["Win rate", stats.winRate === null ? "—" : f.ratio(stats.winRate)],
    ["Average odds", stats.avgOddsBp === null ? "—" : f.avgOdds(stats.avgOddsBp)],
    ["Best streak", `${stats.bestStreak} wins`],
    ["Lifetime value", f.money(branch.ltvCents)],
    ["Branch ROI", f.pct(stats.roiBp, 1, true)],
    ["Peak capital", f.money(branch.peakCapitalCents)],
    ["Wins / losses / voids", `${branch.wins} / ${branch.losses} / ${branch.voids}`],
    ["Capital lost", f.money(branch.totalLostCents)],
    ["Descendants (alive)", `${stats.descendants} (${stats.aliveDescendants})`],
    ["Lifespan", `${stats.lifespanDays} days · ${f.round(branch.roundCount)}`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border px-3 py-2.5">
          <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
          <dd className="mt-1 num text-base font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
