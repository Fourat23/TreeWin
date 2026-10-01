"use client";

import { Popover } from "radix-ui";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { parseMoney } from "@/domain/money";
import { PROFILES, type Profile } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { PROFILE_COLOR_VAR, PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { hasActiveFilters, type GraphFilters, type StatusFilter } from "./tree-model";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ALIVE", label: "Alive" },
  { value: "DEAD", label: "Dead" },
  { value: "MATURE", label: "Mature" },
];

/** Shared filter bar for the tree and network views. */
export function GraphToolbar({
  filters,
  onChange,
  generations,
  onSearchSubmit,
  children,
}: {
  filters: GraphFilters;
  onChange: (next: GraphFilters) => void;
  generations: number[];
  onSearchSubmit?: (query: string) => void;
  children?: ReactNode;
}) {
  const toggleProfile = (profile: Profile) => {
    const next = new Set(filters.profiles);
    if (next.has(profile)) {
      if (next.size > 1) next.delete(profile);
    } else next.add(profile);
    onChange({ ...filters, profiles: next });
  };
  const advancedActive =
    filters.generations !== null ||
    filters.capitalMinCents !== null ||
    filters.capitalMaxCents !== null;

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/90 p-2 backdrop-blur">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit?.(filters.search);
        }}
      >
        <Search
          className="pointer-events-none absolute top-2 left-2.5 size-4 text-fg-subtle"
          aria-hidden
        />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Branch code…"
          aria-label="Search branch code (Enter to center)"
          className="h-8 w-36 pl-8 font-mono text-xs"
        />
      </form>
      <Segmented
        label="Status filter"
        value={filters.status}
        onChange={(status) => onChange({ ...filters, status })}
        options={STATUS_OPTIONS}
      />
      <div className="flex gap-1" role="group" aria-label="Profiles">
        {PROFILES.map((p) => {
          const on = filters.profiles.has(p);
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => toggleProfile(p)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
                on
                  ? "border-border-strong bg-surface-2 text-fg"
                  : "border-border text-fg-subtle line-through",
              )}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: PROFILE_COLOR_VAR[p], opacity: on ? 1 : 0.35 }}
                aria-hidden
              />
              {PROFILE_LABEL[p]}
            </button>
          );
        })}
      </div>
      <AdvancedFilters
        filters={filters}
        onChange={onChange}
        generations={generations}
        active={advancedActive}
      />
      {hasActiveFilters(filters) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              ...filters,
              status: "ALL",
              profiles: new Set(PROFILES),
              generations: null,
              capitalMinCents: null,
              capitalMaxCents: null,
            })
          }
        >
          <X /> Reset
        </Button>
      ) : null}
      {children}
    </div>
  );
}

function AdvancedFilters({
  filters,
  onChange,
  generations,
  active,
}: {
  filters: GraphFilters;
  onChange: (next: GraphFilters) => void;
  generations: number[];
  active: boolean;
}) {
  const centsToInput = (c: number | null) => (c === null ? "" : String(c / 100));
  const gens = generations;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant={active ? "outline" : "ghost"} size="sm" aria-label="More filters">
          <SlidersHorizontal /> Filters{active ? " ·" : ""}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          className="z-50 w-72 rounded-xl border border-border bg-surface-2 p-4 shadow-panel"
        >
          <p className="mb-2 text-[11px] font-medium tracking-wider text-fg-subtle uppercase">
            Generation
          </p>
          <div className="flex flex-wrap gap-1.5">
            {gens.map((g) => {
              const on = filters.generations === null || filters.generations.has(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const current = new Set(filters.generations ?? gens);
                    if (current.has(g)) current.delete(g);
                    else current.add(g);
                    onChange({
                      ...filters,
                      generations:
                        current.size === gens.length || current.size === 0 ? null : current,
                    });
                  }}
                  className={cn(
                    "h-7 min-w-8 rounded-md border px-2 text-xs",
                    on
                      ? "border-border-strong bg-surface-3 text-fg"
                      : "border-border text-fg-subtle",
                  )}
                >
                  {g}
                </button>
              );
            })}
          </div>
          <p className="mt-4 mb-2 text-[11px] font-medium tracking-wider text-fg-subtle uppercase">
            Capital range (€)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Minimum capital"
              placeholder="min"
              inputMode="decimal"
              defaultValue={centsToInput(filters.capitalMinCents)}
              onBlur={(e) =>
                onChange({
                  ...filters,
                  capitalMinCents: e.target.value ? parseMoney(e.target.value) : null,
                })
              }
            />
            <Input
              aria-label="Maximum capital"
              placeholder="max"
              inputMode="decimal"
              defaultValue={centsToInput(filters.capitalMaxCents)}
              onBlur={(e) =>
                onChange({
                  ...filters,
                  capitalMaxCents: e.target.value ? parseMoney(e.target.value) : null,
                })
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-fg-subtle">
            Ancestors of matching branches stay visible (dimmed) to keep the tree readable.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
