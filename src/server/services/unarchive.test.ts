import { describe, expect, it } from "vitest";
import { createTicket, settleTicket } from "./bet-service";
import { createRootBranch, updateBranchNotes } from "./branch-service";
import { archiveCandidate, createCandidate, linkCandidateToBet } from "./candidate-service";
import { applyCorrection } from "./correction-service";
import { unarchiveCandidate, unarchiveEntry } from "./unarchive-service";
import { expectDomainError, ticketInput, workspaceHarness } from "./test-helpers";

/** A reaches P1 (A1 born, BANK 100) and A1 dies; then A wins once more. */
function treeWithDeadChild() {
  const h = workspaceHarness("REAL");
  const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
  const rounds = [1, 2, 3, 4].map(() => h.play(a.id, 13_000, "WON"));
  h.play(h.branch("A1").id, 12_500, "LOST");
  h.play(a.id, 12_800, "WON");
  return { h, a, p1Bet: rounds[3]?.bet };
}

const snapshot = (h: ReturnType<typeof workspaceHarness>) =>
  JSON.parse(
    JSON.stringify({
      branches: [...h.state.branches].sort((x, y) => x.code.localeCompare(y.code)),
      bets: [...h.state.bets].sort((x, y) => x.id.localeCompare(y.id)),
      bank: h.state.bankTransactions,
    }),
  );

describe("unarchive", () => {
  it("restores an archived root subtree as it was — a DEAD child stays DEAD", () => {
    const { h, a } = treeWithDeadChild();
    const before = snapshot(h);
    const { archiveId } = applyCorrection(
      h.state,
      { target: { kind: "DELETE_BRANCH", branchId: a.id } },
      h.ctx(),
    );
    expect(h.state.branches).toHaveLength(0);

    const result = unarchiveEntry(h.state, { archiveId: archiveId ?? "" }, h.ctx());
    expect(result).toMatchObject({ branches: 2, bankCents: 10_000 });
    expect(h.state.archive).toHaveLength(0);
    expect(h.branch("A1").status).toBe("DEAD");
    const after = snapshot(h);
    // Same records, apart from the journal line and updatedAt stamps.
    expect(after.bets).toEqual(before.bets);
    expect(after.bank).toEqual(before.bank);
    expect(
      after.branches.map((b: { code: string; status: string; currentCapitalCents: number }) => [
        b.code,
        b.status,
        b.currentCapitalCents,
      ]),
    ).toEqual(
      before.branches.map((b: { code: string; status: string; currentCapitalCents: number }) => [
        b.code,
        b.status,
        b.currentCapitalCents,
      ]),
    );
    expect(h.events(a.id).at(-1)?.metadata).toMatchObject({ kind: "UNARCHIVE", archiveId });
    h.expectValid();
  });

  it("restores a 'delete from here' correction onto an unchanged branch", () => {
    const { h, p1Bet } = treeWithDeadChild();
    const before = snapshot(h);
    const { archiveId } = applyCorrection(
      h.state,
      { target: { kind: "DELETE_TICKET", betId: p1Bet?.id ?? "" } },
      h.ctx(),
    );
    expect(h.branch("A").currentCapitalCents).toBe(21_970);
    unarchiveEntry(h.state, { archiveId: archiveId ?? "" }, h.ctx());
    const after = snapshot(h);
    expect(after.bets).toEqual(before.bets);
    expect(after.bank).toEqual(before.bank);
    expect(h.branch("A")).toMatchObject({
      currentCapitalCents: before.branches[0].currentCapitalCents,
      p1Done: true,
    });
    expect(h.branch("A1").status).toBe("DEAD");
    h.expectValid();
  });

  it("restores a reopened ticket's settlement and the candidate link", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const { bet } = createTicket(h.state, ticketInput(a.id, 10_000, 12_400), h.ctx());
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
    settleTicket(h.state, { betId: bet.id, result: "LOST" }, h.ctx());
    const { archiveId } = applyCorrection(
      h.state,
      { target: { kind: "DELETE_TICKET", betId: bet.id } },
      h.ctx(),
    );
    expect(h.state.candidates[0]?.convertedBetId).toBeNull();
    unarchiveEntry(h.state, { archiveId: archiveId ?? "" }, h.ctx());
    expect(h.state.candidates[0]?.convertedBetId).toBe(bet.id);
    expect(h.branch("A").status).toBe("DEAD");
    h.expectValid();
  });

  it("refuses safely when the branch has new history since the correction", () => {
    const { h, p1Bet } = treeWithDeadChild();
    const { archiveId } = applyCorrection(
      h.state,
      { target: { kind: "DELETE_TICKET", betId: p1Bet?.id ?? "" } },
      h.ctx(),
    );
    h.play(h.branch("A").id, 13_000, "WON"); // new history on A
    const before = JSON.stringify(h.state);
    const error = expectDomainError(
      () => unarchiveEntry(h.state, { archiveId: archiveId ?? "" }, h.ctx()),
      "INVALID_STATE",
    );
    expect(error.message).toMatch(/new history since this correction/);
    expect(JSON.stringify(h.state)).toBe(before);
  });

  it("refuses in REAL when a restored pending ticket would break one branch per match", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const b = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const match = { eventName: "PSG - Nantes", eventDate: "2026-10-04" };
    createTicket(h.state, ticketInput(a.id, 10_000, 12_400, match), h.ctx());
    const { archiveId } = applyCorrection(
      h.state,
      { target: { kind: "DELETE_BRANCH", branchId: a.id } },
      h.ctx(),
    );
    createTicket(h.state, ticketInput(b.id, 10_000, 12_400, match), h.ctx());
    expectDomainError(
      () => unarchiveEntry(h.state, { archiveId: archiveId ?? "" }, h.ctx()),
      "INVALID_STATE",
    );
    expect(h.state.archive).toHaveLength(1);
  });

  it("unarchives a candidate, and only an archived one", () => {
    const h = workspaceHarness("DEMO");
    const candidate = createCandidate(
      h.state,
      {
        eventDate: "2026-10-04",
        sport: "Football",
        competition: "Ligue 1",
        eventName: "Nice - Brest",
        marketName: "1N2",
        selection: "Nice",
        oddsObservedBp: 12_500,
        protocolStatus: "WATCH",
      },
      h.ctx(),
    );
    expectDomainError(
      () => unarchiveCandidate(h.state, { id: candidate.id }, h.ctx()),
      "INVALID_STATE",
    );
    archiveCandidate(h.state, candidate.id, h.ctx());
    expect(unarchiveCandidate(h.state, { id: candidate.id }, h.ctx())).toBe("Nice - Brest");
    expect(h.state.candidates[0]?.archivedAt).toBeNull();
    h.expectValid();
  });

  it("does not revive a DEAD branch that was never archived", () => {
    const { h } = treeWithDeadChild();
    expect(h.state.archive).toHaveLength(0);
    updateBranchNotes(
      h.state,
      { branchId: h.branch("A1").id, notes: "dead, not archived" },
      h.ctx(),
    );
    expect(h.branch("A1").status).toBe("DEAD");
  });
});
