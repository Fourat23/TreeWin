"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useFormat } from "@/components/providers/format-provider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { PROFILE_COLOR_VAR, PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { TicketGroupStats } from "@/domain/analytics/stats";
import type { AnalyticsDTO, Distribution, TicketBreakdownRow } from "@/server/queries/analytics";

export function AnalyticsView({ data }: { data: AnalyticsDTO }) {
  const f = useFormat();
  if (data.global.tickets === 0 && data.profiles.every((p) => p.branches === 0)) {
    return (
      <Card>
        <EmptyState
          title="Nothing to analyse yet"
          description="Analytics appear once branches have played some rounds."
        />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <GlobalCard stats={data.global} minSample={data.minSample} />

      <Card>
        <CardHeader
          title="Profiles compared"
          description="Mean · median — medians resist the few outliers that dominate means."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y border-border text-left text-[11px] tracking-wider text-fg-subtle uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Metric</th>
                {data.profiles.map((p) => (
                  <th key={p.profile} className="px-5 py-2.5 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: PROFILE_COLOR_VAR[p.profile] }}
                        aria-hidden
                      />
                      {PROFILE_LABEL[p.profile]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <Row
                label="Branches (alive / dead / mature)"
                values={data.profiles.map(
                  (p) => `${p.branches} (${p.alive} / ${p.dead} / ${p.mature})`,
                )}
              />
              <Row
                label="Win rate"
                values={data.profiles.map((p) => (p.winRate === null ? "—" : f.ratio(p.winRate)))}
              />
              <Row
                label={`${f.roundLabel}s played`}
                values={data.profiles.map((p) => pair(p.roundsPlayed, (v) => v.toFixed(1)))}
              />
              <Row
                label={`Survival ${f.roundLabel.toLowerCase()}s (dead)`}
                values={data.profiles.map((p) => pair(p.survivalRounds, (v) => v.toFixed(1)))}
              />
              <Row
                label="Days before death"
                values={data.profiles.map((p) => pair(p.daysToDeath, (v) => v.toFixed(1)))}
              />
              <Row
                label="BANK per branch"
                values={data.profiles.map((p) =>
                  pair(p.bankPerBranchCents, (v) => f.money(Math.round(v))),
                )}
              />
              <Row
                label="Peak capital (max · median)"
                values={data.profiles.map((p) =>
                  p.peakCapitalCents.max === null
                    ? "—"
                    : `${f.money(p.peakCapitalCents.max)} · ${f.money(Math.round(p.peakCapitalCents.median ?? 0))}`,
                )}
              />
              <Row
                label="Children per branch"
                values={data.profiles.map((p) => pair(p.children, (v) => v.toFixed(2)))}
              />
              <Row
                label="Branch ROI (lifetime)"
                values={data.profiles.map((p) =>
                  pair(p.roiBp, (v) => f.pct(Math.round(v), 0, true)),
                )}
              />
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Win rate vs break-even by odds bucket"
          description="Dot = observed win rate, bar = 95 % Wilson interval, tick = break-even (1 / odds). An interval that straddles the tick proves nothing yet."
        />
        <CardBody>
          <RangePlot rows={data.byOddsBucket} />
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <BreakdownCard
          title="By profile"
          rows={data.byProfile.map((r) => ({
            ...r,
            label: PROFILE_LABEL[r.key as keyof typeof PROFILE_LABEL] ?? r.label,
          }))}
        />
        <BreakdownCard title="By sport" rows={data.bySport} />
      </div>
      <BreakdownCard title="By competition" rows={data.byCompetition} />
      <p className="flex items-start gap-2 text-xs text-fg-subtle">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        No automatic conclusion is drawn: edges are only shown from {data.minSample} decided tickets
        (configurable in Settings), and even then the confidence interval matters more than the
        point estimate.
      </p>
    </div>
  );
}

function pair(d: Distribution, fmt: (v: number) => string): string {
  if (d.mean === null || d.median === null) return "—";
  return `${fmt(d.mean)} · ${fmt(d.median)}`;
}

function Row({ label, values }: { label: string; values: ReactNode[] }) {
  return (
    <tr>
      <td className="px-5 py-2.5 text-fg-muted">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-5 py-2.5 text-right num">
          {v}
        </td>
      ))}
    </tr>
  );
}

function GlobalCard({ stats, minSample }: { stats: TicketGroupStats; minSample: number }) {
  const f = useFormat();
  const items: [string, string, string?][] = [
    ["Tickets", f.num(stats.tickets), `${stats.wins}W · ${stats.losses}L · ${stats.voids}V`],
    [
      "Win rate",
      stats.winRate === null ? "—" : f.ratio(stats.winRate),
      stats.winRateInterval
        ? `95 % CI ${f.ratio(stats.winRateInterval.low, 0)}–${f.ratio(stats.winRateInterval.high, 0)}`
        : undefined,
    ],
    ["Break-even", stats.breakEven === null ? "—" : f.ratio(stats.breakEven), "mean of 1 / odds"],
    [
      "Estimated edge",
      stats.edge === null ? "—" : f.ratio(stats.edge),
      stats.significant
        ? "win rate − break-even"
        : `needs ${minSample} decided (have ${stats.decided})`,
    ],
    ["Average odds", stats.avgOdds === null ? "—" : stats.avgOdds.toFixed(3)],
    [
      "Yield",
      stats.yield === null ? "—" : f.ratio(stats.yield),
      `P/L ${f.money(stats.profitCents, { signed: true })}`,
    ],
    [
      "Average CLV",
      stats.avgClvBp === null ? "—" : f.pct(stats.avgClvBp, 1, true),
      `${stats.clvSample} with closing odds`,
    ],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {items.map(([label, value, sub]) => (
        <div key={label} className="card px-4 py-3.5">
          <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">{label}</p>
          <p className="mt-1.5 text-xl font-semibold">{value}</p>
          {sub ? <p className="mt-0.5 text-[11px] text-fg-subtle">{sub}</p> : null}
        </div>
      ))}
    </div>
  );
}

const PLOT_MIN = 0.5;
const PLOT_MAX = 1;
const x = (v: number) =>
  `${((Math.min(PLOT_MAX, Math.max(PLOT_MIN, v)) - PLOT_MIN) / (PLOT_MAX - PLOT_MIN)) * 100}%`;

function RangePlot({ rows }: { rows: TicketBreakdownRow[] }) {
  const f = useFormat();
  if (rows.length === 0) return <p className="text-sm text-fg-subtle">No settled ticket yet.</p>;
  return (
    <div className="flex flex-col gap-1">
      <div
        className="ml-28 flex justify-between pr-36 text-[10px] text-fg-subtle sm:pr-48"
        aria-hidden
      >
        {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((t) => (
          <span key={t}>{f.ratio(t, 0)}</span>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-3 py-1.5">
          <span className="w-25 shrink-0 num text-sm">{row.label}</span>
          <div
            className="relative h-6 flex-1"
            role="img"
            aria-label={`${row.label}: win rate ${row.winRate === null ? "n/a" : f.ratio(row.winRate)}, break-even ${row.breakEven === null ? "n/a" : f.ratio(row.breakEven)}`}
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-grid" />
            {row.winRateInterval ? (
              <div
                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-fg-subtle/50"
                style={{
                  left: x(row.winRateInterval.low),
                  width: `calc(${x(row.winRateInterval.high)} - ${x(row.winRateInterval.low)})`,
                }}
              />
            ) : null}
            {row.breakEven !== null ? (
              <div
                className="absolute top-0.5 bottom-0.5 w-0.5 -translate-x-1/2 rounded bg-warning"
                style={{ left: x(row.breakEven) }}
              />
            ) : null}
            {row.winRate !== null ? (
              <div
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-fg"
                style={{ left: x(row.winRate) }}
              />
            ) : null}
          </div>
          <span className="w-32 shrink-0 text-right num text-xs text-fg-muted sm:w-44">
            n={row.decided} · {row.winRate === null ? "—" : f.ratio(row.winRate)}
            {row.significant ? "" : " · small sample"}
          </span>
        </div>
      ))}
      <ul className="mt-2 flex flex-wrap gap-4 text-[11px] text-fg-subtle" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-fg" /> Win rate
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-fg-subtle/50" /> 95 % interval
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 rounded bg-warning" /> Break-even
        </li>
      </ul>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: TicketBreakdownRow[] }) {
  const f = useFormat();
  return (
    <Card>
      <CardHeader title={title} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-y border-border text-left text-[11px] tracking-wider text-fg-subtle uppercase">
            <tr>
              <th className="px-5 py-2 font-medium">Group</th>
              <th className="px-3 py-2 text-right font-medium">n</th>
              <th className="px-3 py-2 text-right font-medium">Win rate</th>
              <th className="px-3 py-2 text-right font-medium">Break-even</th>
              <th className="px-3 py-2 text-right font-medium">Edge</th>
              <th className="px-5 py-2 text-right font-medium">Yield</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.key} className={cn(!r.significant && "text-fg-muted")}>
                <td className="px-5 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right num">{r.decided}</td>
                <td className="px-3 py-2 text-right num">
                  {r.winRate === null ? "—" : f.ratio(r.winRate)}
                </td>
                <td className="px-3 py-2 text-right num">
                  {r.breakEven === null ? "—" : f.ratio(r.breakEven)}
                </td>
                <td
                  className="px-3 py-2 text-right num"
                  title={r.significant ? undefined : "Sample too small"}
                >
                  {r.edge === null ? <span className="text-fg-subtle">n/a</span> : f.ratio(r.edge)}
                </td>
                <td className="px-5 py-2 text-right num">
                  {r.yield === null ? "—" : f.ratio(r.yield)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
