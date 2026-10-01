import { describe, expect, it } from "vitest";
import { verifyLedger } from "@/domain/branches/metrics";
import { DEFAULT_SETTINGS } from "@/domain/strategy/settings";
import { getDashboard } from "../queries/overview";
import { getTreeHistory, listBranchSummaries } from "../queries/branches";
import { createEmptyState, findIntegrityProblems } from "../state/integrity";
import { bankStatusTotals, markWithdrawn, setBankDestination, undoWithdrawn } from "./bank-service";
import {
  cancelPendingTicket,
  checkTicketConflicts,
  createTicket,
  previewSettlement,
  settleTicket,
  updateTicketDetails,
} from "./bet-service";
import {
  adjustBranchCapital,
  changeBranchProfile,
  createRootBranch,
  setBranchPaused,
  transferToBank,
} from "./branch-service";
import { saveSettings } from "./settings-service";
import { expectDomainError, ticketInput, workspaceHarness } from "./test-helpers";

describe("acceptance scenario (§71) — REAL workspace, V1 rules", () => {
  it("100 € → 130 → 169 → 219.70 → 285.61 ⇒ P1: BANK 100, child 100, mother 85.61; A1 dies", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
    expect(a.code).toBe("A");

    const expected = [13_000, 16_900, 21_970, 28_561];
    let last;
    for (const [i, capital] of expected.entries()) {
      const before = h.branch("A").currentCapitalCents;
      const { bet } = createTicket(h.state, ticketInput(a.id, before, 13_000), h.ctx());
      expect(bet.roundNumber).toBe(i + 1);
      last = settleTicket(h.state, { betId: bet.id, result: "WON" }, h.ctx());
      expect(last.bet.capitalAfterCents).toBe(capital);
    }

    // P1 at 2.80 × S: 285.61 ≥ 280 → BANK +100, A1 created with 100, A keeps 85.61.
    expect(h.bankTotal()).toBe(10_000);
    const mother = h.branch("A");
    expect(mother.currentCapitalCents).toBe(8_561);
    expect(mother.p1Done).toBe(true);
    expect(mother.totalBankGeneratedCents).toBe(10_000);
    expect(mother.totalChildCapitalGeneratedCents).toBe(10_000);
    expect(mother.wins).toBe(4);
    const a1 = h.branch("A1");
    expect(a1.currentCapitalCents).toBe(10_000);
    expect(a1.parentId).toBe(a.id);
    expect(a1.birthBetId).toBe(last?.bet.id);
    expect(h.state.bankTransactions[0]).toMatchObject({
      status: "SECURED",
      withdrawnAt: null,
      harvestKind: "P1",
    });

    const harvest = h.events(a.id).find((e) => e.type === "HARVEST");
    expect(harvest?.metadata).toMatchObject({ kind: "P1", bankCents: 10_000, childCents: 10_000 });
    expect(h.events(a1.id)[0]).toMatchObject({
      type: "BIRTH",
      amountCents: 10_000,
      relatedBranchId: a.id,
    });

    // A1 loses its full stake: DEAD, capital 0, A and BANK unchanged.
    h.play(a1.id, 12_500, "LOST");
    const dead = h.branch("A1");
    expect(dead.status).toBe("DEAD");
    expect(dead.currentCapitalCents).toBe(0);
    expect(dead.totalLostCents).toBe(10_000);
    expect(h.events(a1.id).map((e) => e.type)).toEqual([
      "BIRTH",
      "BET_CREATED",
      "BET_LOST",
      "DEATH",
    ]);
    expect(h.branch("A").currentCapitalCents).toBe(8_561);
    expect(h.bankTotal()).toBe(10_000);
    expectDomainError(
      () => createTicket(h.state, ticketInput(a1.id, 100, 13_000), h.ctx()),
      "INVALID_STATE",
    );

    for (const branch of h.state.branches) {
      expect(verifyLedger(h.events(branch.id), branch.currentCapitalCents).balanced).toBe(true);
    }
    h.expectValid();
  });
});

describe("V1 ticket policy", () => {
  it("REAL requires the full capital as stake — no override possible", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const error = expectDomainError(
      () => createTicket(h.state, ticketInput(a.id, 9_000, 12_400), h.ctx()),
      "POLICY_VIOLATION",
    );
    expect(error.details?.violations).toEqual([
      expect.objectContaining({ code: "STAKE_NOT_FULL", overridable: false }),
    ]);
    expectDomainError(
      () =>
        createTicket(
          h.state,
          ticketInput(a.id, 9_000, 12_400, {
            override: { confirmed: true, reason: "Winamax cap" },
          }),
          h.ctx(),
        ),
      "POLICY_VIOLATION",
    );
    expect(h.state.bets).toHaveLength(0);
  });

  it("REAL refuses odds above 1.30", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "GROWTH", capitalCents: 10_000 }, h.ctx());
    const error = expectDomainError(
      () => createTicket(h.state, ticketInput(a.id, 10_000, 13_100), h.ctx()),
      "POLICY_VIOLATION",
    );
    expect(error.details?.violations).toEqual([
      expect.objectContaining({ code: "ODDS_ABOVE_MAX" }),
    ]);
    expect(createTicket(h.state, ticketInput(a.id, 10_000, 13_000), h.ctx()).bet.oddsBp).toBe(
      13_000,
    );
  });

  it("DEMO allows explicit, journaled experiments outside V1", () => {
    const h = workspaceHarness("DEMO");
    const a = createRootBranch(h.state, { profile: "GROWTH", capitalCents: 10_000 }, h.ctx());
    expectDomainError(
      () => createTicket(h.state, ticketInput(a.id, 5_000, 13_500), h.ctx()),
      "POLICY_VIOLATION",
    );
    const { bet } = createTicket(
      h.state,
      ticketInput(a.id, 5_000, 13_500, {
        override: { confirmed: true, reason: "Half-stake experiment" },
      }),
      h.ctx(),
    );
    expect(bet.overrideReason).toBe("Half-stake experiment");
    const created = h.events(a.id).find((e) => e.type === "BET_CREATED");
    expect(created?.metadata?.overridden).toEqual(["STAKE_NOT_FULL", "ODDS_ABOVE_MAX"]);
    h.expectValid();
  });

  it("never accepts a stake above the capital, even in DEMO", () => {
    const h = workspaceHarness("DEMO");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    expectDomainError(
      () =>
        createTicket(
          h.state,
          ticketInput(a.id, 10_001, 12_400, { override: { confirmed: true, reason: "test" } }),
          h.ctx(),
        ),
      "POLICY_VIOLATION",
    );
  });

  it("a MATURE branch stakes its capped principal", () => {
    const h = workspaceHarness("REAL");
    const b = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 200_000 }, h.ctx());
    h.play(b.id, 13_000, "WON"); // 2 600 € ≥ cap 2 500 € → MATURE, excess split
    expect(h.branch(b.code).status).toBe("MATURE");
    expect(h.branch(b.code).currentCapitalCents).toBe(250_000);
    const { bet } = createTicket(h.state, ticketInput(b.id, 250_000, 12_200), h.ctx());
    expect(bet.stakeCents).toBe(250_000);
  });

  it("one ticket = one single match", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    expectDomainError(
      () =>
        createTicket(
          h.state,
          ticketInput(a.id, 10_000, 12_400, { eventName: "PSG - Nantes + Lyon - Lens" }),
          h.ctx(),
        ),
      "VALIDATION",
    );
    expectDomainError(
      () =>
        createTicket(
          h.state,
          ticketInput(a.id, 10_000, 12_400, { checklist: { singleMatch: "UNKNOWN" } }),
          h.ctx(),
        ),
      "VALIDATION",
    );
  });
});

describe("one branch per match", () => {
  const match = { eventName: "Real Madrid - Getafe", eventDate: "2026-10-04" };

  it("REAL blocks a second branch on the same pending match, without override", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const b = createRootBranch(h.state, { profile: "GROWTH", capitalCents: 10_000 }, h.ctx());
    createTicket(h.state, ticketInput(a.id, 10_000, 12_400, match), h.ctx());
    expect(
      checkTicketConflicts(h.state, { ...match, branchId: b.id }, new Date()).sameEvent.map(
        (c) => c.branchCode,
      ),
    ).toEqual(["A"]);
    for (const override of [undefined, { confirmed: true as const, reason: "Different market" }]) {
      expectDomainError(
        () =>
          createTicket(
            h.state,
            ticketInput(b.id, 10_000, 12_400, {
              eventName: "real madrid vs getafe",
              eventDate: "2026-10-04",
              override,
            }),
            h.ctx(),
          ),
        "POLICY_VIOLATION",
      );
    }
  });

  it("DEMO is more permissive: an explicit override is accepted", () => {
    const h = workspaceHarness("DEMO");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const b = createRootBranch(h.state, { profile: "GROWTH", capitalCents: 10_000 }, h.ctx());
    createTicket(h.state, ticketInput(a.id, 10_000, 12_400, match), h.ctx());
    const { bet } = createTicket(
      h.state,
      ticketInput(b.id, 10_000, 12_400, {
        ...match,
        override: { confirmed: true, reason: "Correlation test" },
      }),
      h.ctx(),
    );
    expect(bet.overrideReason).toBe("Correlation test");
  });

  it("only warns when the policy is WARN; limits are overridable personal preferences", () => {
    const h = workspaceHarness("REAL");
    saveSettings(
      h.state,
      {
        ...DEFAULT_SETTINGS,
        sameEventPolicy: "WARN",
        limits: { maxPendingTickets: null, maxTicketsPerDay: 2 },
      },
      h.ctx(),
    );
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const b = createRootBranch(h.state, { profile: "GROWTH", capitalCents: 10_000 }, h.ctx());
    const c = createRootBranch(h.state, { profile: "GROWTH", capitalCents: 10_000 }, h.ctx());
    createTicket(h.state, ticketInput(a.id, 10_000, 12_400, match), h.ctx());
    const { warnings } = createTicket(h.state, ticketInput(b.id, 10_000, 12_600, match), h.ctx());
    expect(warnings.join(" ")).toMatch(/Same match/);
    expectDomainError(
      () => createTicket(h.state, ticketInput(c.id, 10_000, 12_600), h.ctx()),
      "POLICY_VIOLATION",
    );
    const { bet } = createTicket(
      h.state,
      ticketInput(c.id, 10_000, 12_600, {
        override: { confirmed: true, reason: "Exceptional day" },
      }),
      h.ctx(),
    );
    expect(bet.overrideReason).toBe("Exceptional day");
  });
});

describe("ticket workflow", () => {
  it("creates a pending ticket stamped with the strategy version", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const { bet, warnings } = createTicket(h.state, ticketInput(a.id, 10_000, 12_400), h.ctx());
    expect(bet).toMatchObject({
      result: "PENDING",
      roundNumber: 1,
      sequence: 1,
      potentialReturnCents: 12_400,
      bookmaker: "WINAMAX",
      strategyVersion: "1.0",
      strategyRevision: 0,
    });
    expect(warnings).toEqual([]);
    expectDomainError(
      () => createTicket(h.state, ticketInput(a.id, 10_000, 12_400), h.ctx()),
      "PENDING_EXISTS",
    );
  });

  it("void restores the capital and keeps the round number", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    h.play(a.id, 13_000, "WON");
    const outcome = h.play(a.id, 13_000, "VOID");
    expect(outcome.branch.currentCapitalCents).toBe(13_000);
    expect(outcome.branch.voids).toBe(1);
    expect(outcome.branch.roundCount).toBe(1);
    expect(createTicket(h.state, ticketInput(a.id, 13_000, 13_000), h.ctx()).bet.roundNumber).toBe(
      2,
    );
    h.expectValid();
  });

  it("previews a settlement without changing the state", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
    for (let i = 0; i < 3; i += 1) h.play(a.id, 13_000, "WON");
    const { bet } = createTicket(h.state, ticketInput(a.id, 21_970, 13_000), h.ctx());
    const before = JSON.stringify(h.state);
    const preview = previewSettlement(h.state, { betId: bet.id, result: "WON" });
    expect(preview.plan.finalCapitalCents).toBe(8_561);
    expect(preview.plan.children[0]?.code).toBe("A1");
    expect(JSON.stringify(h.state)).toBe(before);
  });

  it("cancels a pending ticket without touching capital", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const { bet } = createTicket(h.state, ticketInput(a.id, 10_000, 12_400), h.ctx());
    cancelPendingTicket(h.state, { betId: bet.id, reason: "typo" }, h.ctx());
    expectDomainError(
      () => settleTicket(h.state, { betId: bet.id, result: "WON" }, h.ctx()),
      "INVALID_STATE",
    );
    expect(createTicket(h.state, ticketInput(a.id, 10_000, 12_400), h.ctx()).bet.sequence).toBe(2);
    h.expectValid();
  });

  it("honours a user-chosen child profile at settlement", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
    for (let i = 0; i < 3; i += 1) h.play(a.id, 13_000, "WON");
    const { bet } = createTicket(h.state, ticketInput(a.id, 21_970, 13_000), h.ctx());
    settleTicket(h.state, { betId: bet.id, result: "WON", childProfiles: ["GROWTH"] }, h.ctx());
    expect(h.branch("A1")).toMatchObject({ profile: "GROWTH", capCents: 1_000_000 });
    h.expectValid();
  });

  it("journals settled ticket identity edits but not closing odds", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const { bet } = h.play(a.id, 13_000, "WON");
    updateTicketDetails(h.state, { betId: bet.id, closingOddsBp: 12_500 }, h.ctx());
    expect(h.events(a.id).filter((e) => e.type === "MANUAL_ADJUSTMENT")).toHaveLength(0);
    updateTicketDetails(h.state, { betId: bet.id, selection: "Away 1" }, h.ctx());
    expect(h.events(a.id).filter((e) => e.type === "MANUAL_ADJUSTMENT")).toHaveLength(1);
    h.expectValid();
  });
});

describe("branches", () => {
  it("names roots A, B, C and snapshots the profile cap", () => {
    const h = workspaceHarness("REAL");
    const codes = (["HARVEST", "BALANCED", "GROWTH"] as const).map(
      (profile) => createRootBranch(h.state, { profile, capitalCents: 10_000 }, h.ctx()).code,
    );
    expect(codes).toEqual(["A", "B", "C"]);
    expect(h.branch("B").capCents).toBe(500_000);
    expectDomainError(
      () => createRootBranch(h.state, { profile: "HARVEST", capitalCents: 0 }, h.ctx()),
      "VALIDATION",
    );
  });

  it("journals adjustments, manual BANK transfers, profile changes and pauses", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    adjustBranchCapital(
      h.state,
      { branchId: a.id, deltaCents: -500, reason: "Winamax rounding" },
      h.ctx(),
    );
    transferToBank(
      h.state,
      { branchId: a.id, amountCents: 1_500, reason: "Secure some profit" },
      h.ctx(),
    );
    expect(h.branch("A")).toMatchObject({
      currentCapitalCents: 8_000,
      totalBankGeneratedCents: 1_500,
    });
    expectDomainError(
      () =>
        transferToBank(
          h.state,
          { branchId: a.id, amountCents: 8_000, reason: "everything" },
          h.ctx(),
        ),
      "VALIDATION",
    );
    changeBranchProfile(
      h.state,
      {
        branchId: a.id,
        profile: "GROWTH",
        reason: "Exceptional rebalancing",
        applyProfileCap: true,
      },
      h.ctx(),
    );
    expect(h.branch("A")).toMatchObject({ profile: "GROWTH", capCents: 1_000_000 });
    setBranchPaused(h.state, { branchId: a.id, paused: true }, h.ctx());
    expectDomainError(
      () => createTicket(h.state, ticketInput(a.id, 8_000, 12_400), h.ctx()),
      "INVALID_STATE",
    );
    setBranchPaused(h.state, { branchId: a.id, paused: false }, h.ctx());
    expect(h.branch("A").status).toBe("ACTIVE");
    h.expectValid();
  });

  it("records the strategy revision on new records after a strategy change", () => {
    const h = workspaceHarness("REAL");
    createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    const { strategyChanged } = saveSettings(
      h.state,
      { ...DEFAULT_SETTINGS, voidCountsAsRound: true },
      h.ctx(),
    );
    expect(strategyChanged).toBe(true);
    const b = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    expect(h.branch("A").strategyRevision).toBe(0);
    expect(b.strategyRevision).toBe(1);
    expect(h.state.settingsHistory).toHaveLength(1);
    // Display-only changes do not bump the revision.
    expect(
      saveSettings(h.state, { ...h.state.settings, roundLabel: "Tour" }, h.ctx()).strategyChanged,
    ).toBe(false);
  });
});

describe("BANK statuses", () => {
  it("SECURED vs WITHDRAWN never moves money back to a branch", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
    for (let i = 0; i < 4; i += 1) h.play(a.id, 13_000, "WON");
    const tx = h.state.bankTransactions[0];
    if (!tx) throw new Error("missing BANK entry");
    const capitalBefore = h.branch("A").currentCapitalCents;
    expect(bankStatusTotals(h.state)).toEqual({
      securedCents: 10_000,
      withdrawnCents: 0,
      awaitingWithdrawalCents: 10_000,
    });

    markWithdrawn(h.state, { transactionIds: [tx.id], destination: "LIVRET_A" }, h.ctx());
    expect(tx).toMatchObject({ status: "WITHDRAWN", destination: "LIVRET_A" });
    expect(tx.withdrawnAt).not.toBeNull();
    expect(bankStatusTotals(h.state)).toEqual({
      securedCents: 10_000,
      withdrawnCents: 10_000,
      awaitingWithdrawalCents: 0,
    });
    expectDomainError(
      () => markWithdrawn(h.state, { transactionIds: [tx.id] }, h.ctx()),
      "INVALID_STATE",
    );

    undoWithdrawn(h.state, { transactionIds: [tx.id] });
    expect(tx).toMatchObject({ status: "SECURED", withdrawnAt: null });
    setBankDestination(h.state, { transactionIds: [tx.id], destination: "PEA" });
    expect(tx.destination).toBe("PEA");

    // None of it touches branch capital, and the BANK total never decreases.
    expect(h.branch("A").currentCapitalCents).toBe(capitalBefore);
    expect(h.bankTotal()).toBe(10_000);
    h.expectValid();
  });

  it("rejects negative BANK movements and inconsistent withdrawals", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    transferToBank(h.state, { branchId: a.id, amountCents: 1_000, reason: "secure" }, h.ctx());
    const tx = h.state.bankTransactions[0];
    if (!tx) throw new Error("missing");
    const corrupted = structuredClone(h.state);
    (corrupted.bankTransactions[0] as { amountCents: number }).amountCents = -1_000;
    expect(findIntegrityProblems(corrupted, "REAL").length).toBeGreaterThan(0);
    const inconsistent = structuredClone(h.state);
    (inconsistent.bankTransactions[0] as { status: string }).status = "WITHDRAWN";
    expect(findIntegrityProblems(inconsistent, "REAL").join(" ")).toMatch(
      /inconsistent withdrawal/,
    );
  });
});

describe("read models", () => {
  it("a fresh REAL workspace shows zeros and no averages", () => {
    const dashboard = getDashboard(createEmptyState("REAL"));
    expect(dashboard.isEmpty).toBe(true);
    expect(dashboard.totals).toMatchObject({
      bankCents: 0,
      activeCapitalCents: 0,
      ecosystemCents: 0,
      withdrawnCents: 0,
      awaitingWithdrawalCents: 0,
    });
    expect(dashboard.branchCounts.total).toBe(0);
    expect(dashboard.tickets).toMatchObject({
      total: 0,
      winRate: null,
      avgOddsBp: null,
      avgStakeCents: null,
      avgClvBp: null,
    });
    expect(dashboard.activity).toEqual([]);
  });

  it("keeps dead branches in the graph data and their death in the history", () => {
    const h = workspaceHarness("REAL");
    const a = createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx());
    h.play(a.id, 12_400, "LOST");
    expect(listBranchSummaries(h.state)).toEqual([
      expect.objectContaining({ code: "A", status: "DEAD", currentCapitalCents: 0 }),
    ]);
    const history = getTreeHistory(h.state).events.filter((e) => e.branchId === a.id);
    expect(history.map((e) => e.statusAfter)).toEqual(["ACTIVE", "ACTIVE", "DEAD"]);
  });
});
