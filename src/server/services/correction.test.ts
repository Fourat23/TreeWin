import { describe, expect, it } from "vitest";
import { findIntegrityProblems } from "../state/integrity";
import { createTicket, settleTicket } from "./bet-service";
import { adjustBranchCapital, createRootBranch, transferToBank } from "./branch-service";
import { linkCandidateToBet, createCandidate } from "./candidate-service";
import { applyCorrection, previewCorrection, purgeArchiveEntry } from "./correction-service";
import { expectDomainError, ticketInput, workspaceHarness } from "./test-helpers";

/** A: 4 wins @1.30 → P1 (A1 born, BANK 100), then A1 wins twice and A wins once more. */
function grownTree() {
  const h = workspaceHarness("REAL");
  const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
  const rounds = [1, 2, 3, 4].map(() => h.play(a.id, 13_000, "WON"));
  const a1 = h.branch("A1");
  h.play(a1.id, 12_500, "WON");
  h.play(a1.id, 12_500, "WON");
  const r5 = h.play(a.id, 12_800, "WON");
  return { h, a, a1, p1Ticket: rounds[3]?.bet, r3: rounds[2]?.bet, r5: r5.bet };
}

describe("DELETE / REBUILD FROM THIS POINT", () => {
  it("previews the full impact without changing anything", () => {
    const { h, a, r3 } = grownTree();
    const before = JSON.stringify(h.state);
    const impact = previewCorrection(
      h.state,
      { kind: "DELETE_TICKET", betId: r3?.id ?? "" },
      h.ctx(),
    );
    expect(JSON.stringify(h.state)).toBe(before);
    expect(impact.branch).toMatchObject({
      code: "A",
      capitalAfterCents: 16_900,
      statusAfter: "ACTIVE",
    });
    expect(impact.removedTickets.map((t) => `${t.branchCode}·R${t.roundNumber}`).sort()).toEqual(
      ["A1·R1", "A1·R2", "A·R3", "A·R4", "A·R5"].sort(),
    );
    expect(impact.removedBranches.map((b) => b.code)).toEqual(["A1"]);
    expect(impact.bank).toMatchObject({ count: 1, amountCents: 10_000, withdrawnCents: 0 });
    expect(impact.confirmationText).toBe("A");
    expect(a.code).toBe("A");
  });

  it("deleting a settled ticket cascades: later rounds, born subtree and their BANK money go", () => {
    const { h, r3 } = grownTree();
    const result = applyCorrection(
      h.state,
      { target: { kind: "DELETE_TICKET", betId: r3?.id ?? "" } },
      h.ctx(),
    );
    expect(result).toMatchObject({ mode: "ARCHIVE", removedBranches: 1, removedBankCents: 10_000 });
    const a = h.branch("A");
    expect(a).toMatchObject({
      currentCapitalCents: 16_900,
      wins: 2,
      roundCount: 2,
      p1Done: false,
      childCount: 0,
      totalBankGeneratedCents: 0,
      totalChildCapitalGeneratedCents: 0,
      status: "ACTIVE",
    });
    // No orphan, no phantom BANK money.
    expect(h.state.branches.map((b) => b.code)).toEqual(["A"]);
    expect(h.state.bankTransactions).toEqual([]);
    expect(h.state.bets.every((b) => b.branchId === a.id && b.roundNumber <= 2)).toBe(true);
    expect(h.events(a.id).at(-1)?.metadata).toMatchObject({ kind: "CORRECTION", mode: "ARCHIVE" });
    expect(h.state.archive).toHaveLength(1);
    expect(h.state.archive[0]?.branches.map((b) => b.code)).toEqual(["A1"]);
    h.expectValid();

    // Rebuild: the next round is R3 again and P1 can happen again, recreating A1.
    const { bet } = createTicket(h.state, ticketInput(a.id, 16_900, 13_000), h.ctx());
    expect(bet.roundNumber).toBe(3);
    settleTicket(h.state, { betId: bet.id, result: "WON" }, h.ctx());
    h.play(a.id, 13_000, "WON");
    expect(h.branch("A1").currentCapitalCents).toBe(10_000);
    h.expectValid();
  });

  it("reopens a wrongly settled LOST ticket: the branch is alive again and can be settled WON", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const lost = h.play(a.id, 13_000, "LOST");
    expect(h.branch("A").status).toBe("DEAD");

    applyCorrection(h.state, { target: { kind: "REOPEN_TICKET", betId: lost.bet.id } }, h.ctx());
    expect(h.branch("A")).toMatchObject({
      status: "ACTIVE",
      currentCapitalCents: 10_000,
      losses: 0,
      diedAt: null,
      totalLostCents: 0,
    });
    expect(h.state.bets[0]).toMatchObject({
      result: "PENDING",
      settledAt: null,
      profitLossCents: null,
    });
    h.expectValid();

    settleTicket(h.state, { betId: lost.bet.id, result: "WON" }, h.ctx());
    expect(h.branch("A").currentCapitalCents).toBe(13_000);
    h.expectValid();
  });

  it("reopening the P1 ticket removes the child and the BANK money it produced", () => {
    const { h, p1Ticket } = grownTree();
    const impact = previewCorrection(
      h.state,
      { kind: "REOPEN_TICKET", betId: p1Ticket?.id ?? "" },
      h.ctx(),
    );
    expect(impact.reopenedTickets.map((t) => t.roundNumber)).toEqual([4]);
    applyCorrection(
      h.state,
      { target: { kind: "REOPEN_TICKET", betId: p1Ticket?.id ?? "" } },
      h.ctx(),
    );
    expect(h.branch("A")).toMatchObject({ currentCapitalCents: 21_970, wins: 3, p1Done: false });
    expect(h.state.branches).toHaveLength(1);
    expect(h.bankTotal()).toBe(0);
    expect(h.state.bets.filter((b) => b.result === "PENDING")).toHaveLength(1);
    h.expectValid();
  });

  it("warns when removed BANK money was already withdrawn", () => {
    const { h, p1Ticket } = grownTree();
    const tx = h.state.bankTransactions[0];
    if (!tx) throw new Error("missing");
    tx.status = "WITHDRAWN";
    tx.withdrawnAt = tx.createdAt;
    const impact = previewCorrection(
      h.state,
      { kind: "DELETE_TICKET", betId: p1Ticket?.id ?? "" },
      h.ctx(),
    );
    expect(impact.bank.withdrawnCents).toBe(10_000);
    expect(impact.warnings.join(" ")).toMatch(/WITHDRAWN/);
  });

  it("deletes a manual adjustment from the event log and everything after it", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    adjustBranchCapital(
      h.state,
      { branchId: a.id, deltaCents: 2_000, reason: "Typo, should not exist" },
      h.ctx(),
    );
    transferToBank(h.state, { branchId: a.id, amountCents: 1_000, reason: "secure" }, h.ctx());
    const adjustment = h.events(a.id).find((e) => e.type === "MANUAL_ADJUSTMENT");
    applyCorrection(
      h.state,
      { target: { kind: "DELETE_FROM_EVENT", eventId: adjustment?.id ?? 0 } },
      h.ctx(),
    );
    expect(h.branch("A")).toMatchObject({
      currentCapitalCents: 10_000,
      totalBankGeneratedCents: 0,
    });
    expect(h.bankTotal()).toBe(0);
    h.expectValid();
  });

  it("refuses to cut inside a settlement or delete a child branch directly", () => {
    const { h, a1 } = grownTree();
    const harvest = h.state.branchEvents.find((e) => e.type === "HARVEST");
    expectDomainError(
      () =>
        previewCorrection(
          h.state,
          { kind: "DELETE_FROM_EVENT", eventId: harvest?.id ?? 0 },
          h.ctx(),
        ),
      "INVALID_STATE",
    );
    expectDomainError(
      () => previewCorrection(h.state, { kind: "DELETE_BRANCH", branchId: a1.id }, h.ctx()),
      "INVALID_STATE",
    );
  });

  it("deletes a pending ticket alone (no cascade) and unlinks its candidate", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    h.play(a.id, 12_400, "WON");
    const { bet } = createTicket(h.state, ticketInput(a.id, 12_400, 12_400), h.ctx());
    const candidate = createCandidate(
      h.state,
      {
        eventDate: "2026-10-04",
        sport: "Football",
        competition: "Ligue 1",
        eventName: "Lens - Brest",
        marketName: "1N2",
        selection: "Lens",
        oddsObservedBp: 12_400,
        protocolStatus: "ELIGIBLE",
      },
      h.ctx(),
    );
    linkCandidateToBet(h.state, candidate.id, bet.id, h.ctx());
    applyCorrection(
      h.state,
      { target: { kind: "DELETE_TICKET", betId: bet.id }, mode: "PURGE", confirmation: "DELETE" },
      h.ctx(),
    );
    expect(h.state.bets).toHaveLength(1);
    expect(h.branch("A")).toMatchObject({ currentCapitalCents: 12_400, wins: 1 });
    expect(h.state.candidates[0]?.convertedBetId).toBeNull();
    expect(h.state.archive).toHaveLength(0);
    h.expectValid();
  });
});

describe("delete semantics", () => {
  it("permanent purge requires the typed confirmation", () => {
    const { h, a } = grownTree();
    expectDomainError(
      () =>
        applyCorrection(
          h.state,
          { target: { kind: "DELETE_BRANCH", branchId: a.id }, mode: "PURGE" },
          h.ctx(),
        ),
      "VALIDATION",
    );
    applyCorrection(
      h.state,
      { target: { kind: "DELETE_BRANCH", branchId: a.id }, mode: "PURGE", confirmation: "A" },
      h.ctx(),
    );
    expect(h.state.branches).toHaveLength(0);
    expect(h.state.bets).toHaveLength(0);
    expect(h.state.bankTransactions).toHaveLength(0);
    expect(h.state.branchEvents).toHaveLength(0);
    expect(h.state.archive).toHaveLength(0);
    expect(findIntegrityProblems(h.state, "REAL")).toEqual([]);
  });

  it("archives a root subtree by default; archived root codes are never reused", () => {
    const { h, a } = grownTree();
    const result = applyCorrection(
      h.state,
      { target: { kind: "DELETE_BRANCH", branchId: a.id } },
      h.ctx(),
    );
    expect(result.removedBranches).toBe(2);
    expect(h.state.branches).toHaveLength(0);
    expect(h.state.archive[0]?.branches.map((b) => b.code).sort()).toEqual(["A", "A1"]);
    expect(
      createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx()).code,
    ).toBe("B");
    expectDomainError(
      () => purgeArchiveEntry(h.state, { archiveId: result.archiveId ?? "", confirmation: "nope" }),
      "VALIDATION",
    );
    purgeArchiveEntry(h.state, { archiveId: result.archiveId ?? "", confirmation: "DELETE" });
    expect(h.state.archive).toHaveLength(0);
    h.expectValid();
  });
});
