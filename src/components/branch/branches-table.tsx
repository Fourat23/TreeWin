"use client";

import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { compareBranchCodes } from "@/domain/branches/codes";
import { PROFILES, type Profile } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { ProfileDot, StatusBadge } from "@/components/ui/domain-badges";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { BranchSummaryDTO } from "@/server/queries/dto";
import type { StatusFilter } from "@/components/tree/tree-model";

type SortKey = "code" | "capital" | "ltv" | "bank" | "rounds" | "created" | "generation";

const ACCESSORS: Record<SortKey, (b: BranchSummaryDTO) => number | string> = {
  code: (b) => b.code,
  capital: (b) => b.currentCapitalCents,
  ltv: (b) => b.ltvCents,
  bank: (b) => b.totalBankGeneratedCents,
  rounds: (b) => b.roundCount,
  created: (b) => b.createdAt,
  generation: (b) => b.generation,
};

export function BranchesTable({ branches }: { branches: BranchSummaryDTO[] }) {
  const f = useFormat();
  const { openBranch } = useUi();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [profile, setProfile] = useState<Profile | "">("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "code",
    dir: "asc",
  });

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const filtered = branches.filter(
      (b) =>
        (!q || b.code.toUpperCase().includes(q)) &&
        (!profile || b.profile === profile) &&
        (status === "ALL" ||
          (status === "ALIVE" && b.status !== "DEAD") ||
          (status === "DEAD" && b.status === "DEAD") ||
          (status === "MATURE" && b.status === "MATURE")),
    );
    const accessor = ACCESSORS[sort.key];
    return filtered.sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      const cmp =
        typeof va === "string" && typeof vb === "string"
          ? compareBranchCodes(va, vb)
          : Number(va) - Number(vb);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [branches, query, status, profile, sort]);

  const header = (key: SortKey, label: ReactNode, align: "left" | "right" = "left") => {
    const active = sort.key === key;
    return (
      <th
        className={cn(
          "px-3 py-2.5 font-medium whitespace-nowrap",
          align === "right" && "text-right",
        )}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 uppercase hover:text-fg"
          onClick={() =>
            setSort({
              key,
              dir:
                active && sort.dir === "desc"
                  ? "asc"
                  : active
                    ? "desc"
                    : key === "code"
                      ? "asc"
                      : "desc",
            })
          }
        >
          {label}
          {active ? (
            sort.dir === "asc" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )
          ) : null}
        </button>
      </th>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 card p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 size-4 text-fg-subtle"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Branch code…"
            className="w-44 pl-9 font-mono"
            aria-label="Search branch"
          />
        </div>
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "ALL", label: "All" },
            { value: "ALIVE", label: "Alive" },
            { value: "DEAD", label: "Dead" },
            { value: "MATURE", label: "Mature" },
          ]}
        />
        <Select
          aria-label="Profile"
          className="w-36"
          value={profile}
          onChange={(e) => setProfile(e.target.value as Profile | "")}
        >
          <option value="">All profiles</option>
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {PROFILE_LABEL[p]}
            </option>
          ))}
        </Select>
        <span className="ml-auto num text-sm text-fg-muted">{rows.length} branches</span>
        <Button variant="ghost" size="sm" asChild>
          <a href="/api/export/csv/branches" download>
            <Download /> CSV
          </a>
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No branch matches" />
        </div>
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-border text-left text-[11px] tracking-wider text-fg-subtle uppercase">
              <tr>
                {header("code", "Branch")}
                <th className="px-3 py-2.5 font-medium">Status</th>
                {header("generation", "Gen", "right")}
                {header("capital", "Capital", "right")}
                <th className="px-3 py-2.5 text-right font-medium">Birth</th>
                {header("bank", "BANK", "right")}
                {header("ltv", "Lifetime", "right")}
                {header("rounds", f.roundLabel + "s", "right")}
                <th className="px-3 py-2.5 text-right font-medium">W / L</th>
                {header("created", "Born", "right")}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((b) => (
                <tr
                  key={b.id}
                  className={cn(
                    "cursor-pointer hover:bg-surface-2",
                    b.status === "DEAD" && "text-fg-muted",
                  )}
                  onClick={() => openBranch(b.id)}
                >
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 font-mono font-semibold"
                      onClick={() => openBranch(b.id)}
                    >
                      <ProfileDot profile={b.profile} />
                      {b.code}
                    </button>
                    <span className="ml-2 text-xs text-fg-subtle">{PROFILE_LABEL[b.profile]}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-3 py-2.5 text-right num">{b.generation}</td>
                  <td className="px-3 py-2.5 text-right num font-medium">
                    {f.money(b.currentCapitalCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right num text-fg-muted">
                    {f.money(b.birthCapitalCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right num">
                    {f.money(b.totalBankGeneratedCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right num">{f.money(b.ltvCents)}</td>
                  <td className="px-3 py-2.5 text-right num">{b.roundCount}</td>
                  <td className="px-3 py-2.5 text-right num text-fg-muted">
                    {b.wins} / {b.losses}
                  </td>
                  <td className="px-3 py-2.5 text-right num text-fg-muted">
                    {f.date(b.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
