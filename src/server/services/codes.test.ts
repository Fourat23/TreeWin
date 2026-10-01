import { describe, expect, it } from "vitest";
import { nextChildRank } from "@/domain/branches/codes";
import { findIntegrityProblems } from "../state/integrity";
import { settleTicket } from "./bet-service";
import { createRootBranch } from "./branch-service";
import { applyCorrection, type DeleteMode } from "./correction-service";
import { workspaceHarness } from "./test-helpers";

/** A (100 €) reaches P1 → A1; A1 then plays up to its own P1 → A1.1. */
function treeWithNestedChild() {
  const h = workspaceHarness("REAL");
  const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
  const p1 = [1, 2, 3, 4].map(() => h.play(a.id, 13_000, "WON"))[3];
  const a1 = h.branch("A1");
  const a1p1 = [1, 2, 3, 4].map(() => h.play(a1.id, 13_000, "WON"))[3];
  expect(h.branch("A1.1").parentId).toBe(a1.id);
  return { h, a, a1, p1Bet: p1?.bet, nestedBet: a1p1?.bet };
}

/** Replay A's path to P1 again: 4 wins at 1.30 from 100 €. */
function replayToP1(h: ReturnType<typeof workspaceHarness>, branchId: string) {
  while (!h.state.branches.find((b) => b.id === branchId)?.p1Done) h.play(branchId, 13_000, "WON");
}

describe("branch codes are reserved forever", () => {
  it("computes the next free rank from every code ever reserved", () => {
    expect(nextChildRank("A", [])).toBe(1);
    expect(nextChildRank("A", ["A", "A1", "A2", "B1", "A1.1"])).toBe(3);
    expect(nextChildRank("A2", ["A2.1", "A2.2", "A21"])).toBe(3);
    expect(nextChildRank("A1.2", ["A1.2.7", "A1.20"])).toBe(8);
  });

  for (const mode of ["ARCHIVE", "PURGE"] as const satisfies readonly DeleteMode[]) {
    it(`a child corrected away (${mode}) never gives its code back`, () => {
      const { h, a, p1Bet } = treeWithNestedChild();
      applyCorrection(
        h.state,
        { target: { kind: "DELETE_TICKET", betId: p1Bet?.id ?? "" }, mode, confirmation: "A" },
        h.ctx(),
      );
      expect(h.state.branches.map((b) => b.code)).toEqual(["A"]);
      replayToP1(h, a.id);
      expect(h.state.branches.map((b) => b.code).sort()).toEqual(["A", "A2"]);
      expect(h.state.metadata.reservedCodes).toEqual(
        expect.arrayContaining(["A", "A1", "A1.1", "A2"]),
      );
      h.expectValid();
    });
  }

  it("a reopened settlement recreates its child under a new code", () => {
    const { h, a, p1Bet } = treeWithNestedChild();
    applyCorrection(
      h.state,
      { target: { kind: "REOPEN_TICKET", betId: p1Bet?.id ?? "" } },
      h.ctx(),
    );
    // Settle the reopened ticket again (WON): P1 fires again and creates A2, not A1.
    const reopened = h.state.bets.find((b) => b.id === p1Bet?.id);
    expect(reopened?.result).toBe("PENDING");
    const outcome = settleTicket(h.state, { betId: reopened?.id ?? "", result: "WON" }, h.ctx());
    expect(outcome.plan.children.map((c) => c.code)).toEqual(["A2"]);
    expect(h.state.branches.filter((b) => b.parentId === a.id).map((b) => b.code)).toEqual(["A2"]);
    h.expectValid();
  });

  it("nested child codes are never reused either", () => {
    const { h, a1, nestedBet } = treeWithNestedChild();
    applyCorrection(
      h.state,
      {
        target: { kind: "DELETE_TICKET", betId: nestedBet?.id ?? "" },
        mode: "PURGE",
        confirmation: "DELETE",
      },
      h.ctx(),
    );
    expect(h.state.branches.some((b) => b.code === "A1.1")).toBe(false);
    replayToP1(h, a1.id);
    expect(h.state.branches.filter((b) => b.parentId === a1.id).map((b) => b.code)).toEqual([
      "A1.2",
    ]);
    h.expectValid();
  });

  it("a permanently purged root keeps its letter reserved", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    applyCorrection(
      h.state,
      { target: { kind: "DELETE_BRANCH", branchId: a.id }, mode: "PURGE", confirmation: "A" },
      h.ctx(),
    );
    expect(h.state.archive).toHaveLength(0);
    expect(
      createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx()).code,
    ).toBe("C");
    h.expectValid();
  });

  it("files written before the registry existed reserve their codes on load", () => {
    const { h } = treeWithNestedChild();
    const legacy = structuredClone(h.state) as unknown as { metadata: Record<string, unknown> };
    delete legacy.metadata.reservedCodes;
    expect(findIntegrityProblems(legacy, "REAL")).toEqual([]);
  });
});
