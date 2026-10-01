import { describe, expect, it } from "vitest";
import type { BranchSummaryDTO } from "@/server/queries/dto";
import { layoutTree } from "./tree-layout";
import { computeVisibleGraph, DEFAULT_FILTERS, nodeScale, snapshotAt } from "./tree-model";

function branch(
  id: string,
  parentId: string | null,
  overrides: Partial<BranchSummaryDTO> = {},
): BranchSummaryDTO {
  return {
    id,
    code: id.toUpperCase(),
    parentId,
    generation: parentId ? 1 : 0,
    profile: "BALANCED",
    status: "ACTIVE",
    birthReason: parentId ? "P1" : "ROOT",
    birthCapitalCents: 10_000,
    currentCapitalCents: 10_000,
    capCents: 500_000,
    peakCapitalCents: 10_000,
    totalBankGeneratedCents: 0,
    totalChildCapitalGeneratedCents: 0,
    totalLostCents: 0,
    ltvCents: 10_000,
    wins: 0,
    losses: 0,
    voids: 0,
    roundCount: 0,
    childCount: 0,
    hasPendingTicket: false,
    createdAt: 0,
    diedAt: null,
    maturedAt: null,
    lastRoundAt: null,
    strategyVersion: "1.0",
    strategyRevision: 0,
    ...overrides,
  };
}

const tree = [
  branch("a", null),
  branch("a1", "a", { status: "DEAD", currentCapitalCents: 0 }),
  branch("a2", "a", { profile: "GROWTH" }),
  branch("a21", "a2", { generation: 2 }),
  branch("b", null, { profile: "HARVEST", status: "MATURE" }),
];

const ids = (nodes: { branch: BranchSummaryDTO }[]) => nodes.map((n) => n.branch.id).sort();

describe("graph model", () => {
  it("keeps ancestors of matching branches as dimmed context", () => {
    const visible = computeVisibleGraph(tree, {
      filters: { ...DEFAULT_FILTERS, status: "DEAD" },
      collapsed: new Set(),
      focusId: null,
    });
    expect(ids(visible)).toEqual(["a", "a1"]);
    expect(visible.find((v) => v.branch.id === "a")?.context).toBe(true);
  });

  it("collapses descendants and reports how many are hidden", () => {
    const visible = computeVisibleGraph(tree, {
      filters: DEFAULT_FILTERS,
      collapsed: new Set(["a"]),
      focusId: null,
    });
    expect(ids(visible)).toEqual(["a", "b"]);
    expect(visible.find((v) => v.branch.id === "a")?.hiddenDescendants).toBe(3);
  });

  it("focuses a lineage", () => {
    const visible = computeVisibleGraph(tree, {
      filters: DEFAULT_FILTERS,
      collapsed: new Set(),
      focusId: "a2",
    });
    expect(ids(visible)).toEqual(["a", "a2", "a21"]);
  });

  it("scales nodes with a square root, bounded", () => {
    expect(nodeScale(tree[0] as BranchSummaryDTO, "NORMAL", 1)).toBe(1);
    const small = nodeScale(
      branch("s", null, { currentCapitalCents: 10_000 }),
      "CAPITAL",
      1_000_000,
    );
    const big = nodeScale(
      branch("s", null, { currentCapitalCents: 1_000_000 }),
      "CAPITAL",
      1_000_000,
    );
    expect(small).toBeGreaterThanOrEqual(0.8);
    expect(big).toBeCloseTo(1.45);
    expect(big / small).toBeLessThan(2);
  });

  it("rebuilds historical snapshots from the event log", () => {
    const events = [
      {
        id: 1,
        branchId: "a",
        createdAt: 1,
        capitalAfterCents: 10_000,
        statusAfter: "ACTIVE" as const,
      },
      {
        id: 2,
        branchId: "a",
        createdAt: 2,
        capitalAfterCents: 13_000,
        statusAfter: "ACTIVE" as const,
      },
      {
        id: 3,
        branchId: "a1",
        createdAt: 3,
        capitalAfterCents: 10_000,
        statusAfter: "ACTIVE" as const,
      },
    ];
    const atTwo = snapshotAt(tree, events, 1);
    expect(atTwo.map((b) => b.id)).toEqual(["a"]);
    expect(atTwo[0]?.currentCapitalCents).toBe(13_000);
    expect(snapshotAt(tree, events, 2).map((b) => b.id)).toEqual(["a", "a1"]);
  });
});

describe("tree layout", () => {
  it("places children below their parent without overlaps", () => {
    const positions = layoutTree(
      tree.map((b) => ({ id: b.id, parentId: b.parentId, code: b.code, scale: 1 })),
      { orientation: "TB", nodeWidth: 100, nodeHeight: 50, gapX: 20, gapY: 40 },
    );
    const a = positions.get("a");
    const a1 = positions.get("a1");
    const a2 = positions.get("a2");
    expect(a && a1 && a2).toBeTruthy();
    if (!a || !a1 || !a2) return;
    expect(a1.y).toBeGreaterThan(a.y);
    expect(Math.abs(a2.x - a1.x)).toBeGreaterThanOrEqual(100);
    const all = [...positions.values()];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const p = all[i] as { x: number; y: number };
        const q = all[j] as { x: number; y: number };
        const overlap = Math.abs(p.x - q.x) < 100 && Math.abs(p.y - q.y) < 50;
        expect(overlap).toBe(false);
      }
    }
  });
});
