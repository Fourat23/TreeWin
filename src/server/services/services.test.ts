import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyLedger } from "@/domain/branches/metrics";
import type { DatabaseHandle } from "../db/client";
import { bankTransactions, bets, branchEvents, branches } from "../db/schema";
import {
  createTicket,
  cancelPendingTicket,
  checkRevertible,
  checkTicketConflicts,
  previewSettlement,
  revertSettlement,
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
import { DomainError } from "./errors";
import { getSettings, saveSettings } from "./settings-service";
import { setupTestDb, ticketInput } from "./test-helpers";

let handle: DatabaseHandle;
const db = () => handle.db;

beforeEach(() => {
  handle = setupTestDb();
});

function branchByCode(code: string) {
  const row = db().select().from(branches).where(eq(branches.code, code)).get();
  if (!row) throw new Error(`branch ${code} missing`);
  return row;
}

function bankTotal(): number {
  return Number(
    db()
      .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(bankTransactions)
      .get()?.total ?? 0,
  );
}

function eventsOf(branchId: string) {
  return db()
    .select()
    .from(branchEvents)
    .where(eq(branchEvents.branchId, branchId))
    .orderBy(branchEvents.id)
    .all();
}

function playRound(branchId: string, oddsBp: number, result: "WON" | "LOST" | "VOID") {
  const branch = db().select().from(branches).where(eq(branches.id, branchId)).get();
  if (!branch) throw new Error("missing branch");
  const { bet } = createTicket(db(), ticketInput(branchId, branch.currentCapitalCents, oddsBp));
  return settleTicket(db(), { betId: bet.id, result });
}

/** Root of 100 € after three wins at 1.30 (219.70 €): the next win at 1.30 fires P1. */
function branchReadyForP1(profile: "HARVEST" | "BALANCED" | "GROWTH" = "BALANCED") {
  const root = createRootBranch(db(), { profile, capitalCents: 10_000 });
  for (let i = 0; i < 3; i += 1) playRound(root.id, 13_000, "WON");
  expect(branchByCode(root.code).currentCapitalCents).toBe(21_970);
  return root;
}

function expectDomainError(fn: () => unknown, code: DomainError["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return error as DomainError;
  }
  throw new Error(`Expected DomainError ${code}`);
}

describe("acceptance scenario (§71)", () => {
  it("A 100 € → 4 wins @1.30 → P1 → A1 dies, BANK stays at 100 €", () => {
    // 1. Create A with 100 €.
    const a = createRootBranch(db(), { profile: "BALANCED", capitalCents: 10_000 });
    expect(a.code).toBe("A");

    // 2–5. Four winning rounds at 1.30.
    const expected = [13_000, 16_900, 21_970, 28_561];
    let last;
    for (const [i, capital] of expected.entries()) {
      const before = branchByCode("A").currentCapitalCents;
      const { bet } = createTicket(db(), ticketInput(a.id, before, 13_000));
      expect(bet.roundNumber).toBe(i + 1);
      last = settleTicket(db(), { betId: bet.id, result: "WON" });
      expect(last.bet.capitalAfterCents).toBe(capital);
    }

    // 6. P1: BANK +100, A1 created with 100, A keeps 85.61.
    expect(bankTotal()).toBe(10_000);
    const motherAfterP1 = branchByCode("A");
    expect(motherAfterP1.currentCapitalCents).toBe(8_561);
    expect(motherAfterP1.totalBankGeneratedCents).toBe(10_000);
    expect(motherAfterP1.totalChildCapitalGeneratedCents).toBe(10_000);
    expect(motherAfterP1.wins).toBe(4);
    expect(motherAfterP1.roundCount).toBe(4);
    const a1 = branchByCode("A1");
    expect(a1.currentCapitalCents).toBe(10_000);

    // 7. Graph: A └── A1.
    expect(a1.parentId).toBe(a.id);
    expect(a1.generation).toBe(1);
    expect(a1.birthBetId).toBe(last?.bet.id);

    // 8. A's history: R1..R4, P1, BANK transfer, child created.
    const aTypes = eventsOf(a.id).map((e) => e.type);
    expect(aTypes.filter((t) => t === "BET_WON")).toHaveLength(4);
    expect(aTypes).toEqual(
      expect.arrayContaining(["BIRTH", "HARVEST", "BANK_TRANSFER", "CHILD_CREATED", "SPLIT"]),
    );
    const harvest = eventsOf(a.id).find((e) => e.type === "HARVEST");
    expect(harvest?.metadata).toMatchObject({ kind: "P1", bankCents: 10_000, childCents: 10_000 });

    // 9. A1: birth, parent A, 100 €.
    const a1Events = eventsOf(a1.id);
    expect(a1Events[0]).toMatchObject({
      type: "BIRTH",
      amountCents: 10_000,
      relatedBranchId: a.id,
    });

    // 10–11. A1 loses: DEAD, capital 0.
    playRound(a1.id, 12_500, "LOST");
    const deadA1 = branchByCode("A1");
    expect(deadA1.status).toBe("DEAD");
    expect(deadA1.currentCapitalCents).toBe(0);
    expect(deadA1.diedAt).not.toBeNull();
    expect(deadA1.totalLostCents).toBe(10_000);
    expect(eventsOf(a1.id).map((e) => e.type)).toEqual([
      "BIRTH",
      "BET_CREATED",
      "BET_LOST",
      "DEATH",
    ]);

    // 12. A unchanged.
    expect(branchByCode("A").currentCapitalCents).toBe(8_561);
    // 13. BANK still 100 €.
    expect(bankTotal()).toBe(10_000);

    // A dead branch cannot open a new round.
    expectDomainError(() => createTicket(db(), ticketInput(a1.id, 100, 13_000)), "INVALID_STATE");

    // Every branch ledger is explained by its events.
    for (const branch of db().select().from(branches).all()) {
      expect(verifyLedger(eventsOf(branch.id), branch.currentCapitalCents).balanced).toBe(true);
    }
  });
});

describe("ticket workflow", () => {
  it("creates a pending ticket with round number and potential return", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    const { bet, warnings } = createTicket(db(), ticketInput(a.id, 10_000, 12_400));
    expect(bet.result).toBe("PENDING");
    expect(bet.roundNumber).toBe(1);
    expect(bet.sequence).toBe(1);
    expect(bet.potentialReturnCents).toBe(12_400);
    expect(bet.capitalBeforeCents).toBe(10_000);
    expect(bet.bookmaker).toBe("WINAMAX");
    expect(warnings).toEqual([]);
  });

  it("allows only one pending ticket per branch", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    createTicket(db(), ticketInput(a.id, 10_000, 12_400));
    expectDomainError(
      () => createTicket(db(), ticketInput(a.id, 10_000, 12_400)),
      "PENDING_EXISTS",
    );
  });

  it("warns when the stake is lower than suggested and rejects oversized stakes", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    expectDomainError(() => createTicket(db(), ticketInput(a.id, 10_001, 12_400)), "VALIDATION");
    const { warnings } = createTicket(db(), ticketInput(a.id, 9_000, 12_400));
    expect(warnings.join(" ")).toMatch(/Stake below/);
  });

  it("void restores the capital and keeps the round number", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    playRound(a.id, 13_000, "WON");
    const outcome = playRound(a.id, 13_000, "VOID");
    expect(outcome.branch.currentCapitalCents).toBe(13_000);
    expect(outcome.branch.voids).toBe(1);
    expect(outcome.branch.roundCount).toBe(1);
    const { bet } = createTicket(db(), ticketInput(a.id, 13_000, 13_000));
    expect(bet.roundNumber).toBe(2);
    expect(bet.sequence).toBe(3);
  });

  it("previews a settlement without writing", () => {
    const a = branchReadyForP1();
    const { bet } = createTicket(db(), ticketInput(a.id, 21_970, 13_000));
    const before = db().select().from(branchEvents).all().length;
    const preview = previewSettlement(db(), { betId: bet.id, result: "WON" });
    expect(preview.plan.finalCapitalCents).toBe(8_561);
    expect(preview.plan.children[0]?.code).toBe("A1");
    expect(db().select().from(branchEvents).all().length).toBe(before);
    expect(branchByCode("A").currentCapitalCents).toBe(21_970);
  });

  it("cancels a pending ticket without touching capital", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    const { bet } = createTicket(db(), ticketInput(a.id, 10_000, 12_400));
    cancelPendingTicket(db(), { betId: bet.id, reason: "typo" });
    expectDomainError(() => settleTicket(db(), { betId: bet.id, result: "WON" }), "INVALID_STATE");
    // A new round can now be opened.
    expect(createTicket(db(), ticketInput(a.id, 10_000, 12_400)).bet.sequence).toBe(2);
  });

  it("honours a user-chosen child profile at settlement", () => {
    const a = branchReadyForP1();
    const { bet } = createTicket(db(), ticketInput(a.id, 21_970, 13_000));
    const outcome = settleTicket(db(), { betId: bet.id, result: "WON", childProfiles: ["GROWTH"] });
    expect(outcome.plan.children[0]?.profile).toBe("GROWTH");
    expect(branchByCode("A1").profile).toBe("GROWTH");
    expect(branchByCode("A1").capCents).toBe(1_000_000);
  });
});

describe("same match protection", () => {
  it("blocks a second branch on the same pending match unless explicitly overridden", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    const b = createRootBranch(db(), { profile: "GROWTH", capitalCents: 10_000 });
    const match = { eventName: "Real Madrid - Getafe", eventDate: "2026-10-04" };
    createTicket(db(), ticketInput(a.id, 10_000, 12_400, match));

    const conflicts = checkTicketConflicts(db(), { ...match, branchId: b.id });
    expect(conflicts.sameEvent.map((c) => c.branchCode)).toEqual(["A"]);

    const error = expectDomainError(
      () =>
        createTicket(
          db(),
          ticketInput(b.id, 10_000, 12_400, {
            eventName: "real madrid vs getafe",
            eventDate: "2026-10-04",
          }),
        ),
      "SAME_EVENT_CONFLICT",
    );
    expect(error.message).toMatch(/A/);

    const { bet } = createTicket(
      db(),
      ticketInput(b.id, 10_000, 12_400, {
        ...match,
        override: { confirmed: true, reason: "Different market, accepted correlation" },
      }),
    );
    expect(bet.overrideReason).toBe("Different market, accepted correlation");
  });

  it("only warns when the policy is WARN, and ignores settled tickets", () => {
    saveSettings(db(), { ...getSettings(db()), sameEventPolicy: "WARN" });
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    const b = createRootBranch(db(), { profile: "GROWTH", capitalCents: 10_000 });
    const match = { eventName: "PSG - Nantes", eventDate: "2026-10-05" };
    createTicket(db(), ticketInput(a.id, 10_000, 12_400, match));
    const { warnings } = createTicket(db(), ticketInput(b.id, 10_000, 12_400, match));
    expect(warnings.join(" ")).toMatch(/Same match/);
  });

  it("enforces the daily ticket limit", () => {
    saveSettings(db(), {
      ...getSettings(db()),
      limits: { maxPendingTickets: null, maxTicketsPerDay: 1 },
    });
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    const b = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    createTicket(db(), ticketInput(a.id, 10_000, 12_400));
    expectDomainError(() => createTicket(db(), ticketInput(b.id, 10_000, 12_400)), "LIMIT_REACHED");
  });
});

describe("transactions & integrity", () => {
  it("rolls back the whole split when one write fails", () => {
    const a = branchReadyForP1();
    const { bet } = createTicket(db(), ticketInput(a.id, 21_970, 13_000));
    // Corrupt state: a stray branch already owns the code the child would receive.
    handle.sqlite
      .prepare(
        `INSERT INTO branches (id, code, generation, profile, status, birth_reason, birth_capital_cents,
          current_capital_cents, cap_cents, peak_capital_cents, created_at, updated_at)
         VALUES ('stray', 'A1', 1, 'HARVEST', 'ACTIVE', 'ROOT', 100, 100, 100, 100, 0, 0)`,
      )
      .run();
    const eventsBefore = db().select().from(branchEvents).all().length;

    expect(() => settleTicket(db(), { betId: bet.id, result: "WON" })).toThrow();

    const mother = branchByCode("A");
    expect(mother.currentCapitalCents).toBe(21_970);
    expect(mother.wins).toBe(3);
    expect(bankTotal()).toBe(0);
    expect(db().select().from(bets).where(eq(bets.id, bet.id)).get()?.result).toBe("PENDING");
    expect(db().select().from(branchEvents).all().length).toBe(eventsBefore);
  });

  it("creates BANK transactions linked to the ticket and the branch profile", () => {
    const a = branchReadyForP1("GROWTH");
    const outcome = playRound(a.id, 13_000, "WON");
    const txs = db().select().from(bankTransactions).all();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      amountCents: 10_000,
      type: "HARVEST",
      harvestKind: "P1",
      profile: "GROWTH",
      relatedBetId: outcome.bet.id,
      destination: "UNALLOCATED",
    });
  });

  it("refuses negative BANK movements at the database level", () => {
    const a = createRootBranch(db(), { profile: "GROWTH", capitalCents: 10_000 });
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO bank_transactions (id, branch_id, amount_cents, created_at, type, profile)
           VALUES ('neg', ?, -100, 0, 'MANUAL', 'GROWTH')`,
        )
        .run(a.id),
    ).toThrow(/CHECK/);
  });
});

describe("corrections", () => {
  it("reverts a wrong LOST settlement and lets the ticket be settled again", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    const lost = playRound(a.id, 13_000, "LOST");
    expect(branchByCode("A").status).toBe("DEAD");
    expect(checkRevertible(db(), lost.bet.id).revertible).toBe(true);

    revertSettlement(db(), { betId: lost.bet.id, reason: "Clicked LOST instead of WON" });
    const restored = branchByCode("A");
    expect(restored.status).toBe("ACTIVE");
    expect(restored.currentCapitalCents).toBe(10_000);
    expect(restored.losses).toBe(0);
    expect(restored.diedAt).toBeNull();

    settleTicket(db(), { betId: lost.bet.id, result: "WON" });
    expect(branchByCode("A").currentCapitalCents).toBe(13_000);
    expect(verifyLedger(eventsOf(a.id), 13_000).balanced).toBe(true);
  });

  it("does not revert a settlement that created children or BANK money", () => {
    const a = branchReadyForP1();
    const won = playRound(a.id, 13_000, "WON");
    expect(checkRevertible(db(), won.bet.id)).toMatchObject({ revertible: false });
    expectDomainError(
      () => revertSettlement(db(), { betId: won.bet.id, reason: "test" }),
      "NOT_REVERTIBLE",
    );
  });

  it("journals manual capital adjustments and BANK transfers", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    adjustBranchCapital(db(), { branchId: a.id, deltaCents: -500, reason: "Winamax rounding" });
    transferToBank(db(), { branchId: a.id, amountCents: 1_500, reason: "Secure some profit" });
    const branch = branchByCode("A");
    expect(branch.currentCapitalCents).toBe(8_000);
    expect(branch.totalBankGeneratedCents).toBe(1_500);
    expect(bankTotal()).toBe(1_500);
    expect(verifyLedger(eventsOf(a.id), 8_000).balanced).toBe(true);
    expectDomainError(
      () => transferToBank(db(), { branchId: a.id, amountCents: 8_000, reason: "everything" }),
      "VALIDATION",
    );
  });

  it("journals settled ticket edits but not closing odds", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    const { bet } = playRound(a.id, 13_000, "WON");
    updateTicketDetails(db(), { betId: bet.id, closingOddsBp: 12_500 });
    expect(eventsOf(a.id).filter((e) => e.type === "MANUAL_ADJUSTMENT")).toHaveLength(0);
    updateTicketDetails(db(), { betId: bet.id, selection: "Away 1" });
    expect(eventsOf(a.id).filter((e) => e.type === "MANUAL_ADJUSTMENT")).toHaveLength(1);
  });

  it("changes profiles only explicitly, with a journal entry", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    changeBranchProfile(db(), {
      branchId: a.id,
      profile: "GROWTH",
      reason: "Exceptional rebalancing",
      applyProfileCap: true,
    });
    const branch = branchByCode("A");
    expect(branch.profile).toBe("GROWTH");
    expect(branch.capCents).toBe(1_000_000);
    expect(eventsOf(a.id).at(-1)?.type).toBe("PROFILE_CHANGED");
  });

  it("pauses and resumes branches", () => {
    const a = createRootBranch(db(), { profile: "HARVEST", capitalCents: 10_000 });
    setBranchPaused(db(), { branchId: a.id, paused: true });
    expectDomainError(() => createTicket(db(), ticketInput(a.id, 10_000, 12_400)), "INVALID_STATE");
    setBranchPaused(db(), { branchId: a.id, paused: false });
    expect(branchByCode("A").status).toBe("ACTIVE");
  });
});

describe("root branches", () => {
  it("names roots A, B, C and snapshots the profile cap", () => {
    const codes = ["HARVEST", "BALANCED", "GROWTH"].map(
      (profile) =>
        createRootBranch(db(), {
          profile: profile as "HARVEST" | "BALANCED" | "GROWTH",
          capitalCents: 10_000,
        }).code,
    );
    expect(codes).toEqual(["A", "B", "C"]);
    expect(branchByCode("B").capCents).toBe(500_000);
  });

  it("validates the initial capital", () => {
    expectDomainError(
      () => createRootBranch(db(), { profile: "HARVEST", capitalCents: 0 }),
      "VALIDATION",
    );
  });
});
