"use client";

import { ChevronRight } from "lucide-react";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProfileDot, StatusBadge } from "@/components/ui/domain-badges";
import { cn } from "@/lib/cn";
import type { BranchSummaryDTO } from "@/server/queries/dto";
import type { LineageDTO } from "@/server/queries/branches";

export function LineageView({ lineage }: { lineage: LineageDTO }) {
  const f = useFormat();
  const { stats } = lineage;
  const chain = [...lineage.ancestors, lineage.branch];
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardBody className="pt-5">
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Ancestry">
            {chain.map((b, i) => (
              <li key={b.id} className="flex items-center gap-1.5">
                <ChainChip branch={b} current={i === chain.length - 1} />
                {i < chain.length - 1 ? (
                  <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
                ) : null}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Alive capital (lineage)" value={f.money(stats.aliveCapitalCents)} />
        <Metric label="BANK produced (lineage)" value={f.money(stats.bankCents)} />
        <Metric
          label="Branches"
          value={`${stats.size}`}
          sub={`${stats.alive} alive · ${stats.dead} dead · ${stats.mature} mature`}
        />
        <Metric label={`${f.roundLabel}s played`} value={f.num(stats.rounds)} />
      </dl>

      {stats.best ? (
        <p className="text-sm text-fg-muted">
          Best branch by lifetime value:{" "}
          <span className="font-mono font-semibold text-fg">{stats.best.code}</span> —{" "}
          <span className="num text-fg">{f.money(stats.best.ltvCents)}</span> generated.
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Descendants"
          description={`${lineage.descendants.length} branches born from ${lineage.branch.code}`}
        />
        <CardBody>
          {lineage.descendants.length === 0 ? (
            <p className="text-sm text-fg-subtle">No descendant yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {lineage.descendants.map((d) => (
                <li key={d.id} style={{ paddingLeft: `${(d.depth - 1) * 20}px` }}>
                  <DescendantRow branch={d} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ChainChip({ branch, current }: { branch: BranchSummaryDTO; current: boolean }) {
  const { openBranch } = useUi();
  return (
    <button
      type="button"
      onClick={() => openBranch(branch.id)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-sm font-semibold",
        current
          ? "border-fg/50 bg-surface-3"
          : "border-border bg-surface-2 hover:border-border-strong",
        branch.status === "DEAD" && "text-fg-subtle",
      )}
    >
      <ProfileDot profile={branch.profile} />
      {branch.code}
    </button>
  );
}

function DescendantRow({ branch }: { branch: BranchSummaryDTO }) {
  const f = useFormat();
  const { openBranch } = useUi();
  return (
    <button
      type="button"
      onClick={() => openBranch(branch.id)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border-l-2 border-border px-3 py-2 text-left hover:bg-surface-2"
    >
      <span className="flex items-center gap-2">
        <ProfileDot profile={branch.profile} />
        <span className="font-mono font-semibold">{branch.code}</span>
        <StatusBadge status={branch.status} />
      </span>
      <span className="num text-sm text-fg-muted">
        {f.money(branch.currentCapitalCents)} · BANK {f.money(branch.totalBankGeneratedCents)}
      </span>
    </button>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd className="mt-1.5 text-xl font-semibold">{value}</dd>
      {sub ? <dd className="text-[11px] text-fg-subtle">{sub}</dd> : null}
    </div>
  );
}
