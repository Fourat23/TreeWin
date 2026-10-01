"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { PROFILES } from "@/domain/types";
import { useFormat } from "@/components/providers/format-provider";
import { Button } from "@/components/ui/button";
import { ProfileDot, ResultBadge } from "@/components/ui/domain-badges";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { BetDTO } from "@/server/queries/dto";
import type { TicketFilters, TicketListDTO } from "@/server/queries/tickets";

type SortKey = TicketFilters["sort"];

export function TicketsJournal({ data, filters }: { data: TicketListDTO; filters: TicketFilters }) {
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q ?? "");

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced text search.
  useEffect(() => {
    if ((filters.q ?? "") === query) return;
    const t = window.setTimeout(() => update({ q: query || undefined }), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [query]);

  const sortBy = (key: SortKey) =>
    update({
      sort: key,
      dir: filters.sort === key && filters.dir === "desc" ? "asc" : "desc",
    });

  const anyFilter = Boolean(
    filters.q ||
    filters.branch ||
    filters.profile ||
    filters.sport ||
    filters.status ||
    filters.from ||
    filters.to ||
    filters.oddsMin ||
    filters.oddsMax,
  );

  return (
    <div className={cn("flex flex-col gap-4", pending && "opacity-80")}>
      <div className="flex flex-wrap items-end gap-2 card p-3">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 size-4 text-fg-subtle"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search match, selection, competition, branch…"
            aria-label="Search tickets"
            className="pl-9"
          />
        </div>
        <FilterSelect
          label="Status"
          value={filters.status ?? ""}
          onChange={(v) => update({ status: v })}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
          <option value="VOID">Void</option>
          <option value="CANCELLED">Cancelled</option>
        </FilterSelect>
        <FilterSelect
          label="Branch"
          value={filters.branch ?? ""}
          onChange={(v) => update({ branch: v })}
        >
          <option value="">All branches</option>
          {data.facets.branches.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Profile"
          value={filters.profile ?? ""}
          onChange={(v) => update({ profile: v })}
        >
          <option value="">All profiles</option>
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {PROFILE_LABEL[p]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Sport"
          value={filters.sport ?? ""}
          onChange={(v) => update({ sport: v })}
        >
          <option value="">All sports</option>
          {data.facets.sports.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FilterSelect>
        <label className="flex flex-col gap-1 text-[11px] text-fg-subtle">
          From
          <Input
            type="date"
            className="h-9 w-36"
            value={filters.from ?? ""}
            onChange={(e) => update({ from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-fg-subtle">
          To
          <Input
            type="date"
            className="h-9 w-36"
            value={filters.to ?? ""}
            onChange={(e) => update({ to: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-fg-subtle">
          Odds
          <span className="flex items-center gap-1">
            <Input
              className="h-9 w-16 num"
              placeholder="min"
              defaultValue={filters.oddsMin ?? ""}
              onBlur={(e) => update({ oddsMin: e.target.value })}
              aria-label="Minimum odds"
            />
            <span className="text-fg-subtle">–</span>
            <Input
              className="h-9 w-16 num"
              placeholder="max"
              defaultValue={filters.oddsMax ?? ""}
              onBlur={(e) => update({ oddsMax: e.target.value })}
              aria-label="Maximum odds"
            />
          </span>
        </label>
        {anyFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <X /> Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <p>
          <span className="num font-medium text-fg">{f.num(data.total)}</span> tickets ·{" "}
          {data.summary.won}W · {data.summary.lost}L · {data.summary.void}V · {data.summary.pending}{" "}
          pending · stake <span className="num">{f.money(data.summary.stakeCents)}</span> · P/L{" "}
          <span
            className={cn("num", data.summary.profitCents >= 0 ? "text-good" : "text-critical")}
          >
            {f.money(data.summary.profitCents, { signed: true })}
          </span>
        </p>
        <Button variant="ghost" size="sm" asChild>
          <a href="/api/export/csv/tickets" download>
            <Download /> CSV
          </a>
        </Button>
      </div>

      {data.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No ticket matches"
            description={
              anyFilter
                ? "Try clearing some filters."
                : "Open a new round to record your first ticket."
            }
          />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto card md:block">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="border-b border-border text-left text-[11px] tracking-wider text-fg-subtle uppercase">
                <tr>
                  <Th sort="round" current={filters} onSort={sortBy}>
                    {f.roundShortLabel}
                  </Th>
                  <Th sort="branch" current={filters} onSort={sortBy}>
                    Branch
                  </Th>
                  <Th sort="event" current={filters} onSort={sortBy}>
                    Date
                  </Th>
                  <Th>Sport</Th>
                  <Th>Match · selection</Th>
                  <Th sort="odds" current={filters} onSort={sortBy} align="right">
                    Odds
                  </Th>
                  <Th sort="stake" current={filters} onSort={sortBy} align="right">
                    Stake
                  </Th>
                  <Th>Status</Th>
                  <Th align="right">Return</Th>
                  <Th sort="profit" current={filters} onSort={sortBy} align="right">
                    P/L
                  </Th>
                  <Th align="right">Capital after</Th>
                  <Th align="right">Closing</Th>
                  <Th align="right">CLV</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((bet) => (
                  <TicketRow key={bet.id} bet={bet} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.rows.map((bet) => (
              <TicketCard key={bet.id} bet={bet} />
            ))}
          </ul>
        </>
      )}

      {data.pageCount > 1 ? (
        <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
          <Button
            size="sm"
            disabled={data.page <= 1}
            onClick={() => update({ page: String(data.page - 1) })}
          >
            <ChevronLeft /> Previous
          </Button>
          <span className="num text-sm text-fg-muted">
            Page {data.page} / {data.pageCount}
          </span>
          <Button
            size="sm"
            disabled={data.page >= data.pageCount}
            onClick={() => update({ page: String(data.page + 1) })}
          >
            Next <ChevronRight />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-fg-subtle">
      {label}
      <Select className="h-9 w-36" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </label>
  );
}

function Th({
  children,
  sort,
  current,
  onSort,
  align = "left",
}: {
  children: ReactNode;
  sort?: SortKey;
  current?: TicketFilters;
  onSort?: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort && current?.sort === sort;
  const ariaSort = active ? (current?.dir === "asc" ? "ascending" : "descending") : undefined;
  return (
    <th
      className={cn("px-3 py-2.5 font-medium whitespace-nowrap", align === "right" && "text-right")}
      aria-sort={ariaSort}
    >
      {sort && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sort)}
          className="inline-flex items-center gap-1 uppercase hover:text-fg"
        >
          {children}
          {active ? (
            current?.dir === "asc" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )
          ) : null}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function TicketRow({ bet }: { bet: BetDTO }) {
  const f = useFormat();
  const router = useRouter();
  const href = `/tickets/${bet.id}`;
  return (
    <tr
      className={cn("cursor-pointer hover:bg-surface-2", bet.cancelledAt && "opacity-55")}
      onClick={() => router.push(href)}
    >
      <td className="px-3 py-2.5 num text-fg-muted">{f.round(bet.roundNumber)}</td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 font-mono font-semibold">
          <ProfileDot profile={bet.branchProfile} />
          {bet.branchCode}
        </span>
      </td>
      <td className="px-3 py-2.5 num whitespace-nowrap text-fg-muted">{f.day(bet.eventDate)}</td>
      <td className="px-3 py-2.5 text-fg-muted">{bet.sport}</td>
      <td className="max-w-[280px] px-3 py-2.5">
        <Link
          href={href}
          className="block truncate text-fg hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {bet.eventName}
        </Link>
        <span className="block truncate text-xs text-fg-subtle">
          {bet.selection} · {bet.competition}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right num">{f.odds(bet.oddsBp)}</td>
      <td className="px-3 py-2.5 text-right num">{f.money(bet.stakeCents)}</td>
      <td className="px-3 py-2.5">
        <ResultBadge result={bet.result} cancelled={Boolean(bet.cancelledAt)} />
      </td>
      <td className="px-3 py-2.5 text-right num text-fg-muted">
        {bet.actualReturnCents !== null ? f.money(bet.actualReturnCents) : "—"}
      </td>
      <td
        className={cn(
          "px-3 py-2.5 text-right num",
          (bet.profitLossCents ?? 0) > 0
            ? "text-good"
            : (bet.profitLossCents ?? 0) < 0
              ? "text-critical"
              : "text-fg-subtle",
        )}
      >
        {bet.profitLossCents !== null ? f.money(bet.profitLossCents, { signed: true }) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right num">
        {bet.capitalAfterCents !== null ? f.money(bet.capitalAfterCents) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right num text-fg-muted">
        {bet.closingOddsBp ? f.odds(bet.closingOddsBp) : "—"}
      </td>
      <td
        className={cn(
          "px-3 py-2.5 text-right num",
          (bet.clvBp ?? 0) > 0 ? "text-good" : "text-fg-muted",
        )}
      >
        {bet.clvBp !== null ? f.pct(bet.clvBp, 1, true) : "—"}
      </td>
    </tr>
  );
}

function TicketCard({ bet }: { bet: BetDTO }) {
  const f = useFormat();
  return (
    <li>
      <Link
        href={`/tickets/${bet.id}`}
        className={cn("block card p-3.5", bet.cancelledAt && "opacity-60")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <ProfileDot profile={bet.branchProfile} />
            <span className="font-mono font-semibold">{bet.branchCode}</span>
            <span className="text-fg-subtle">
              · {f.round(bet.roundNumber)} · {f.shortDay(bet.eventDate)}
            </span>
          </span>
          <ResultBadge result={bet.result} cancelled={Boolean(bet.cancelledAt)} />
        </div>
        <p className="mt-1.5 truncate text-sm">{bet.eventName}</p>
        <p className="truncate text-xs text-fg-subtle">{bet.selection}</p>
        <div className="mt-2 flex justify-between text-xs">
          <span className="num">
            {f.money(bet.stakeCents)} @{f.odds(bet.oddsBp)}
          </span>
          <span
            className={cn("num", (bet.profitLossCents ?? 0) >= 0 ? "text-good" : "text-critical")}
          >
            {bet.profitLossCents !== null
              ? f.money(bet.profitLossCents, { signed: true })
              : f.money(bet.potentialReturnCents)}
          </span>
        </div>
      </Link>
    </li>
  );
}
