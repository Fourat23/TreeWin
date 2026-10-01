import { ancestorsOf, buildTreeIndex, descendantsOf, lineageIds } from "@/domain/branches/lineage";
import type { BranchStatus, Profile } from "@/domain/types";
import type { BranchSummaryDTO } from "@/server/queries/dto";

/**
 * Pure graph model shared by the tree and network views: filtering, collapsing, lineage
 * focus, node sizing and historical snapshots. Kept free of React for testing.
 */

export type StatusFilter = "ALL" | "ALIVE" | "DEAD" | "MATURE";
export type SizeMode = "NORMAL" | "CAPITAL" | "LIFETIME_VALUE";

export interface GraphFilters {
  status: StatusFilter;
  profiles: ReadonlySet<Profile>;
  /** Null = every generation. */
  generations: ReadonlySet<number> | null;
  capitalMinCents: number | null;
  capitalMaxCents: number | null;
  search: string;
}

export const DEFAULT_FILTERS: GraphFilters = {
  status: "ALL",
  profiles: new Set<Profile>(["HARVEST", "BALANCED", "GROWTH"]),
  generations: null,
  capitalMinCents: null,
  capitalMaxCents: null,
  search: "",
};

export function hasActiveFilters(filters: GraphFilters): boolean {
  return (
    filters.status !== "ALL" ||
    filters.profiles.size < 3 ||
    filters.generations !== null ||
    filters.capitalMinCents !== null ||
    filters.capitalMaxCents !== null
  );
}

function statusMatches(status: BranchStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "ALIVE":
      return status !== "DEAD";
    case "DEAD":
      return status === "DEAD";
    case "MATURE":
      return status === "MATURE";
  }
}

export function matchesFilters(branch: BranchSummaryDTO, filters: GraphFilters): boolean {
  return (
    statusMatches(branch.status, filters.status) &&
    filters.profiles.has(branch.profile) &&
    (filters.generations === null || filters.generations.has(branch.generation)) &&
    (filters.capitalMinCents === null || branch.currentCapitalCents >= filters.capitalMinCents) &&
    (filters.capitalMaxCents === null || branch.currentCapitalCents <= filters.capitalMaxCents)
  );
}

export interface VisibleNode {
  branch: BranchSummaryDTO;
  /** Shown only to keep the structure readable (an ancestor of a match). */
  context: boolean;
  /** Matches the search box. */
  searchHit: boolean;
  /** Number of hidden descendants when collapsed. */
  hiddenDescendants: number;
  hasChildren: boolean;
}

export function computeVisibleGraph(
  branches: readonly BranchSummaryDTO[],
  options: {
    filters: GraphFilters;
    collapsed: ReadonlySet<string>;
    focusId: string | null;
  },
): VisibleNode[] {
  const index = buildTreeIndex(branches);
  const { filters, collapsed, focusId } = options;

  // 1. Collapse: hide every descendant of a collapsed node.
  const hiddenByCollapse = new Set<string>();
  const hiddenCount = new Map<string, number>();
  for (const id of collapsed) {
    if (!index.byId.has(id)) continue;
    const descendants = descendantsOf(index, id);
    hiddenCount.set(id, descendants.length);
    for (const d of descendants) hiddenByCollapse.add(d.id);
  }

  // 2. Lineage focus.
  const focus = focusId && index.byId.has(focusId) ? lineageIds(index, focusId) : null;

  // 3. Filters (+ ancestors kept as context so the tree stays connected).
  const filtering = hasActiveFilters(filters);
  const matching = new Set<string>();
  const context = new Set<string>();
  for (const branch of branches) {
    if (!filtering || matchesFilters(branch, filters)) matching.add(branch.id);
  }
  if (filtering) {
    for (const id of matching) {
      for (const ancestor of ancestorsOf(index, id))
        if (!matching.has(ancestor.id)) context.add(ancestor.id);
    }
  }

  const query = filters.search.trim().toUpperCase();
  return branches
    .filter((b) => !hiddenByCollapse.has(b.id))
    .filter((b) => !focus || focus.has(b.id))
    .filter((b) => matching.has(b.id) || context.has(b.id))
    .map((branch) => ({
      branch,
      context: context.has(branch.id),
      searchHit: query.length > 0 && branch.code.toUpperCase().includes(query),
      hiddenDescendants: hiddenCount.get(branch.id) ?? 0,
      hasChildren: (index.children.get(branch.id)?.length ?? 0) > 0,
    }));
}

/** Node scale in [0.8, 1.45] — square-root scale so a 10 000 € node doesn't crush a 100 € one. */
export function nodeScale(branch: BranchSummaryDTO, mode: SizeMode, maxValueCents: number): number {
  if (mode === "NORMAL" || maxValueCents <= 0) return 1;
  const value = mode === "CAPITAL" ? branch.currentCapitalCents : branch.ltvCents;
  return 0.8 + 0.65 * Math.sqrt(Math.max(0, value) / maxValueCents);
}

export function maxSizeValue(branches: readonly BranchSummaryDTO[], mode: SizeMode): number {
  if (mode === "NORMAL") return 0;
  return branches.reduce(
    (max, b) => Math.max(max, mode === "CAPITAL" ? b.currentCapitalCents : b.ltvCents),
    0,
  );
}

export interface HistoryEvent {
  id: number;
  branchId: string;
  createdAt: number;
  capitalAfterCents: number | null;
  statusAfter: BranchStatus | null;
}

/**
 * State of the ecosystem right after the `upto`-th event (inclusive, chronological order):
 * branches not yet born are removed; capital and status come from the latest snapshot.
 */
export function snapshotAt(
  branches: readonly BranchSummaryDTO[],
  events: readonly HistoryEvent[],
  upto: number,
): BranchSummaryDTO[] {
  const state = new Map<string, { capital: number; status: BranchStatus }>();
  for (let i = 0; i <= upto && i < events.length; i += 1) {
    const event = events[i] as HistoryEvent;
    const previous = state.get(event.branchId);
    state.set(event.branchId, {
      capital: event.capitalAfterCents ?? previous?.capital ?? 0,
      status: event.statusAfter ?? previous?.status ?? "ACTIVE",
    });
  }
  return branches
    .filter((b) => state.has(b.id))
    .map((b) => {
      const s = state.get(b.id) as { capital: number; status: BranchStatus };
      return { ...b, currentCapitalCents: s.capital, status: s.status };
    });
}
