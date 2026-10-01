"use client";

import { ArrowRight, FlaskConical, Plus, ShieldCheck, Sprout, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { PROFILES } from "@/domain/types";
import { MoneyAreaChart, CountLinesChart } from "@/components/charts/time-charts";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { PROFILE_COLOR_VAR, PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { DashboardDTO } from "@/server/queries/overview";
import { initializeDemoAction } from "@/server/actions/workspace-actions";
import { ActivityFeed } from "./activity-feed";

export function DashboardView({ data }: { data: DashboardDTO }) {
  const f = useFormat();
  const { openNewTicket, openCreateBranch, hints, workspace } = useUi();

  const { totals, tickets, branchCounts, bankPeriods } = data;
  const hasBank = totals.bankCents > 0;
  const securedShare = totals.ecosystemCents > 0 ? totals.bankCents / totals.ecosystemCents : 0;

  return (
    <div className="flex flex-col gap-5">
      {data.isEmpty ? <EmptyDashboard /> : null}
      {!data.isEmpty && workspace === "REAL" && branchCounts.alive === 0 ? (
        <Card data-testid="ledger-finished">
          <div className="flex items-start gap-3 px-6 py-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-fg-muted">
              <strong className="text-fg">
                Every REAL branch is dead — this ledger is finished.
              </strong>{" "}
              External capital enters a REAL ledger only once and the BANK never funds branches.
              Starting again with a new €100 seed requires a Factory Reset REAL (Settings), which
              starts a brand-new ledger after saving this one as a recovery snapshot.
            </p>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card className="relative overflow-hidden">
          <div className="px-6 pt-5 pb-6">
            <p className="flex items-center gap-2 text-[12px] font-medium tracking-[0.16em] text-fg-muted uppercase">
              <ShieldCheck className="size-4" aria-hidden /> BANK · total secured
            </p>
            <AnimatedNumber
              value={totals.bankCents}
              format={(v) => f.money(v)}
              className="mt-2 block text-5xl font-semibold tracking-tight sm:text-6xl"
            />
            <p className="mt-2 text-sm text-fg-subtle">
              Money that left the tree for good. It never funds a branch again.
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-subtle">Withdrawn</dt>
                <dd className="num font-semibold text-good" data-testid="dashboard-withdrawn">
                  {f.money(totals.withdrawnCents)}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-subtle">Awaiting withdrawal</dt>
                <dd className="num font-semibold" data-testid="dashboard-awaiting">
                  {f.money(totals.awaitingWithdrawalCents)}
                </dd>
              </div>
            </dl>
            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Period label="Today" value={bankPeriods.today} />
              <Period label="This week" value={bankPeriods.week} />
              <Period label="This month" value={bankPeriods.month} />
              <Period label="Last 30 days" value={bankPeriods.last30d} />
            </dl>
          </div>
        </Card>

        <Card>
          <div className="flex h-full flex-col px-6 pt-5 pb-6">
            <p className="text-[12px] font-medium tracking-[0.16em] text-fg-muted uppercase">
              Total ecosystem value
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">
              {f.money(totals.ecosystemCents)}
            </p>
            <div
              className="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={`Secured ${f.ratio(securedShare)}, at risk ${f.ratio(1 - securedShare)}`}
            >
              <div
                className="rounded-l-full bg-secured"
                style={{ width: `${securedShare * 100}%` }}
              />
              <div
                className="flex-1 rounded-r-full"
                style={{
                  background:
                    "repeating-linear-gradient(135deg, var(--at-risk) 0 3px, color-mix(in oklab, var(--at-risk) 55%, transparent) 3px 6px)",
                }}
              />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <dt className="flex items-center gap-2 text-xs text-fg-muted">
                  <span className="size-2 rounded-full bg-secured" aria-hidden /> Secured (BANK)
                </dt>
                <dd className="mt-1 text-lg font-semibold">{f.money(totals.bankCents)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-xs text-fg-muted">
                  <span className="size-2 rounded-full bg-at-risk" aria-hidden /> At risk (active
                  capital)
                </dt>
                <dd className="mt-1 text-lg font-semibold">{f.money(totals.activeCapitalCents)}</dd>
              </div>
            </dl>
            <p className="mt-auto pt-4 text-xs text-fg-subtle">
              Secured and at-risk money are never mixed: active capital can still be lost.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          label="Active capital"
          value={f.money(totals.activeCapitalCents)}
          hint="Σ capital of alive branches"
        />
        <Tile
          label="Branches"
          value={f.num(branchCounts.total)}
          sub={`${branchCounts.alive} alive · ${branchCounts.active} active · ${branchCounts.paused} paused`}
        />
        <Tile label="Mature" value={f.num(branchCounts.mature)} sub="at their cap" />
        <Tile
          label="Dead branches"
          value={f.num(branchCounts.dead)}
          sub={`of ${branchCounts.total} created`}
        />
        <Tile
          label="Tickets"
          value={f.num(tickets.total)}
          sub={`${tickets.won}W · ${tickets.lost}L · ${tickets.void}V · ${tickets.pending} pending`}
        />
        <Tile
          label="Win rate"
          value={tickets.winRate === null ? "—" : f.ratio(tickets.winRate)}
          sub="won / (won + lost)"
        />
        <Tile
          label="Average odds"
          value={tickets.avgOddsBp === null ? "—" : f.avgOdds(tickets.avgOddsBp)}
        />
        <Tile
          label="Average stake"
          value={tickets.avgStakeCents === null ? "—" : f.money(tickets.avgStakeCents)}
        />
        <Tile
          label="Total harvested"
          value={f.money(totals.harvestedCents)}
          hint="Everything branches gave away: BANK transfers + capital used to create children"
          sub={`${f.money(totals.childCapitalCents, { compact: true })} into children`}
        />
        <Tile
          label="Total lost"
          value={f.money(totals.lostCents)}
          hint="Σ stakes of lost tickets"
        />
        <Tile
          label="Net secured"
          value={f.money(totals.netSecuredCents, { signed: true })}
          hint="BANK − external capital injected into roots"
          sub={`injected ${f.money(totals.injectedCents, { compact: true })}`}
        />
        <Tile
          label="Avg CLV"
          value={tickets.avgClvBp === null ? "—" : f.pct(tickets.avgClvBp, 1, true)}
          sub={
            tickets.clvSample
              ? `${tickets.clvSample} tickets with closing odds`
              : "no closing odds yet"
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="BANK over time"
            action={
              <Link
                href="/bank"
                className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
              >
                BANK history <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <CardBody>
            {hasBank ? (
              <MoneyAreaChart
                name="BANK"
                data={data.bankSeries.map((p) => ({ day: p.day, value: p.cumulativeCents }))}
              />
            ) : (
              <EmptyState
                title="Nothing secured yet"
                description="The BANK grows when a branch reaches P1, a threshold or profits above its cap."
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Profiles" description="Branches per profile — alive vs dead" />
          <CardBody>
            {branchCounts.total > 0 ? (
              <ProfileBars profiles={data.profiles} />
            ) : (
              <EmptyState
                title="No branch yet"
                description="Profiles appear once a root branch exists."
              />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Branches over time" />
          <CardBody>
            {branchCounts.total > 0 ? (
              <CountLinesChart
                data={data.branchSeries}
                series={[
                  { key: "alive", name: "Alive", color: "var(--fg)" },
                  { key: "dead", name: "Dead", color: "var(--dead)" },
                ]}
              />
            ) : (
              <EmptyState
                title="No branch yet"
                description="Births and deaths are charted here over time."
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Recent activity"
            action={
              <Link
                href="/activity"
                className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
              >
                All <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <CardBody className="max-h-[300px] overflow-y-auto">
            {data.activity.length > 0 ? (
              <ActivityFeed items={data.activity} dense />
            ) : (
              <EmptyState
                title="No activity yet"
                description="Every ticket, harvest and BANK transfer is journaled here."
              />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 lg:hidden">
        <Button variant="primary" onClick={() => openNewTicket()}>
          <Plus /> New round
        </Button>
        {hints.canCreateRoot ? (
          <Button onClick={openCreateBranch}>
            <Sprout /> Create branch
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Period({ label, value }: { label: string; value: number }) {
  const f = useFormat();
  return (
    <div>
      <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium", value > 0 ? "text-fg" : "text-fg-subtle")}>
        {value > 0 ? f.money(value, { signed: true }) : f.money(0)}
      </dd>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
}) {
  const body = (
    <div className="h-full card px-4 py-3.5">
      <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">{label}</p>
      <p className="mt-1.5 truncate text-xl font-semibold tracking-tight">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{sub}</p> : null}
    </div>
  );
  return hint ? (
    <Tooltip content={hint}>
      <div tabIndex={0} className="rounded-[0.875rem]">
        {body}
      </div>
    </Tooltip>
  ) : (
    body
  );
}

function ProfileBars({ profiles }: { profiles: DashboardDTO["profiles"] }) {
  const f = useFormat();
  const max = Math.max(1, ...profiles.map((p) => p.total));
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex gap-4 text-xs text-fg-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-fg-muted" aria-hidden /> Alive (profile colour)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-dead" aria-hidden /> Dead
        </li>
      </ul>
      {PROFILES.map((profile) => {
        const p = profiles.find((x) => x.profile === profile);
        if (!p) return null;
        return (
          <div key={profile}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="flex items-center gap-2 text-fg">
                <span
                  className="size-2 rounded-full"
                  style={{ background: PROFILE_COLOR_VAR[profile] }}
                  aria-hidden
                />
                {PROFILE_LABEL[profile]}
              </span>
              <span className="text-xs text-fg-muted">
                {p.alive} alive · {p.dead} dead{p.mature ? ` · ${p.mature} mature` : ""}
              </span>
            </div>
            <div className="flex h-2.5 gap-0.5" style={{ width: `${(p.total / max) * 100}%` }}>
              {p.alive > 0 ? (
                <div
                  className="h-full rounded-l-sm"
                  style={{ flex: p.alive, background: PROFILE_COLOR_VAR[profile] }}
                />
              ) : null}
              {p.dead > 0 ? (
                <div className="h-full rounded-r-sm bg-dead" style={{ flex: p.dead }} />
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              {f.money(p.activeCapitalCents)} at risk · {f.money(p.bankCents)} to BANK
            </p>
          </div>
        );
      })}
    </div>
  );
}

function EmptyDashboard() {
  const { openCreateBranch, notifyMutation, workspace, hints } = useUi();
  const f = useFormat();
  const [pending, startTransition] = useTransition();
  const locked = workspace === "REAL" && !hints.canCreateRoot;
  return (
    <Card data-testid="empty-dashboard">
      <div className="flex flex-col items-start gap-4 px-6 py-5 sm:flex-row sm:items-center">
        <Sprout className="size-7 shrink-0 text-harvest" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">
            {locked
              ? "This REAL ledger has no visible branch — and its external funding is locked"
              : workspace === "REAL"
                ? "Your REAL workspace is empty — plant root A with the €100 seed"
                : "The DEMO workspace is empty"}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            {locked
              ? "CELLTREE receives external capital only once per REAL ledger. A new €100 seed requires a Factory Reset REAL (Settings), which starts a brand-new ledger after saving this one."
              : workspace === "REAL"
                ? `External capital enters REAL exactly once: a single root funded with ${f.money(
                    hints.realSeedCents,
                  )}. Every later branch comes from strategy splits. Each ticket is one round on one single match, placed manually on Winamax.`
                : "Load the demonstration dataset to explore the tree, the BANK and the analytics without touching REAL data."}
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-fg-subtle">
            <TriangleAlert className="size-3.5" /> CELLTREE never connects to Winamax and never
            places a bet.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {hints.canCreateRoot ? (
            <Button variant="primary" onClick={openCreateBranch}>
              <Plus /> Create root branch
            </Button>
          ) : null}
          {workspace === "DEMO" ? (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await initializeDemoAction(workspace);
                  if (result.ok) {
                    toast.success("DEMO data initialized");
                    notifyMutation();
                  } else toast.error(result.message);
                })
              }
            >
              <FlaskConical /> {pending ? "Loading…" : "Initialize demo data"}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
