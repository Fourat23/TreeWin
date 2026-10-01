import { describe, expect, it } from "vitest";
import { REAL_INITIAL_SEED_CENTS, type Profile } from "@/domain/types";
import { createEmptyState, findIntegrityProblems, assertStateIntegrity } from "../state/integrity";
import { prepareImport, exportWorkspace } from "./backup-service";
import { createTicket } from "./bet-service";
import {
  adjustBranchCapital,
  canCreateRootBranch,
  createRootBranch,
  FUNDING_LOCKED_MESSAGE,
} from "./branch-service";
import { applyCorrection } from "./correction-service";
import {
  expectDomainError,
  realLedgerWithChild,
  ticketInput,
  workspaceHarness,
} from "./test-helpers";

const seed = (h: ReturnType<typeof workspaceHarness>, profile: Profile = "BALANCED") =>
  createRootBranch(h.state, { profile, capitalCents: REAL_INITIAL_SEED_CENTS }, h.ctx());

describe("REAL receives external capital exactly once", () => {
  it("a fresh REAL ledger has an unconsumed €100 seed", () => {
    expect(createEmptyState("REAL").metadata.initialFunding).toEqual({
      amountCents: 10_000,
      consumed: false,
      consumedAt: null,
      rootBranchId: null,
    });
    expect(canCreateRootBranch(createEmptyState("REAL"))).toBe(true);
  });

  it("the first REAL root is A, funded with exactly €100, and locks external funding", () => {
    const h = workspaceHarness("REAL");
    const ctx = h.ctx();
    const a = createRootBranch(h.state, { profile: "GROWTH", capitalCents: 10_000 }, ctx);
    expect(a).toMatchObject({ code: "A", profile: "GROWTH", birthCapitalCents: 10_000 });
    expect(h.state.metadata.initialFunding).toEqual({
      amountCents: 10_000,
      consumed: true,
      consumedAt: ctx.now.getTime(),
      rootBranchId: a.id,
    });
    expect(h.events(a.id)[0]?.metadata).toMatchObject({ reason: "ROOT", externalSeed: true });
    expect(canCreateRootBranch(h.state)).toBe(false);
    h.expectValid();
  });

  it("refuses any second REAL root, whatever the amount", () => {
    const h = workspaceHarness("REAL");
    seed(h);
    for (const capitalCents of [10_000, 50_000, 100]) {
      const error = expectDomainError(
        () => createRootBranch(h.state, { profile: "HARVEST", capitalCents }, h.ctx()),
        "FUNDING_LOCKED",
      );
      expect(error.message).toBe(FUNDING_LOCKED_MESSAGE);
    }
    expect(h.state.branches.map((b) => b.code)).toEqual(["A"]);
  });

  it("refuses a REAL seed other than exactly €100 (and leaves funding unconsumed)", () => {
    const h = workspaceHarness("REAL");
    for (const capitalCents of [9_900, 10_100, 50_000]) {
      expectDomainError(
        () => createRootBranch(h.state, { profile: "BALANCED", capitalCents }, h.ctx()),
        "VALIDATION",
      );
    }
    expect(h.state.branches).toHaveLength(0);
    expect(h.state.metadata.initialFunding.consumed).toBe(false);
  });

  it("stays locked after A dies", () => {
    const h = workspaceHarness("REAL");
    const a = seed(h, "HARVEST");
    h.play(a.id, 12_400, "LOST");
    expect(h.branch("A").status).toBe("DEAD");
    expectDomainError(() => seed(h), "FUNDING_LOCKED");
  });

  it("stays locked after A is archived, purged or corrected away", () => {
    for (const mode of ["ARCHIVE", "PURGE"] as const) {
      const { h, a } = realLedgerWithChild();
      applyCorrection(
        h.state,
        { target: { kind: "DELETE_BRANCH", branchId: a.id }, mode, confirmation: "A" },
        h.ctx(),
      );
      expect(h.state.branches).toHaveLength(0);
      expect(h.state.metadata.initialFunding).toMatchObject({ consumed: true, rootBranchId: a.id });
      expectDomainError(() => seed(h), "FUNDING_LOCKED");
      h.expectValid();
    }
    const { h, a } = realLedgerWithChild();
    const firstTicket = h.state.bets.find((b) => b.branchId === a.id && b.roundNumber === 1);
    applyCorrection(
      h.state,
      { target: { kind: "DELETE_TICKET", betId: firstTicket?.id ?? "" } },
      h.ctx(),
    );
    expectDomainError(() => seed(h), "FUNDING_LOCKED");
  });

  it("a positive manual adjustment is a correction, never a funding event", () => {
    const h = workspaceHarness("REAL");
    const a = seed(h);
    const before = structuredClone(h.state.metadata.initialFunding);
    adjustBranchCapital(
      h.state,
      { branchId: a.id, deltaCents: 500, reason: "Winamax rounding" },
      h.ctx(),
    );
    expect(h.state.metadata.initialFunding).toEqual(before);
    expect(h.events(a.id).at(-1)?.metadata).toMatchObject({ kind: "CAPITAL_CORRECTION" });
    expectDomainError(() => seed(h), "FUNDING_LOCKED");
  });

  it("new REAL branches come from strategy splits only", () => {
    const { h, a1 } = realLedgerWithChild();
    expect(a1).toMatchObject({ birthReason: "P1", birthCapitalCents: 10_000 });
    // A1 plays like any branch (full stake), but no root can be added next to A.
    createTicket(h.state, ticketInput(a1.id, 10_000, 12_400), h.ctx());
    expectDomainError(() => seed(h), "FUNDING_LOCKED");
  });

  it("the integrity check rejects an unconsumed seed next to an existing root", () => {
    const h = workspaceHarness("REAL");
    seed(h);
    const tampered = structuredClone(h.state);
    tampered.metadata.initialFunding = { ...tampered.metadata.initialFunding, consumed: false };
    expect(findIntegrityProblems(tampered, "REAL").join(" ")).toMatch(/external funding/);
  });
});

describe("DEMO stays a sandbox", () => {
  it("allows several roots with arbitrary capital and never consumes funding", () => {
    const h = workspaceHarness("DEMO");
    const codes = [12_345, 200_000, 10_000].map(
      (capitalCents) =>
        createRootBranch(h.state, { profile: "HARVEST", capitalCents }, h.ctx()).code,
    );
    expect(codes).toEqual(["A", "B", "C"]);
    expect(h.state.metadata.initialFunding.consumed).toBe(false);
    h.expectValid();
  });
});

describe("older files and imports", () => {
  const withoutFunding = (state: object) => {
    const raw = JSON.parse(JSON.stringify(state)) as { metadata: Record<string, unknown> };
    delete raw.metadata.initialFunding;
    return raw;
  };

  it("an empty V1.1 file without initialFunding loads as an unconsumed ledger", () => {
    const state = assertStateIntegrity(withoutFunding(createEmptyState("REAL")), "REAL");
    expect(state.metadata.initialFunding).toEqual({
      amountCents: 10_000,
      consumed: false,
      consumedAt: null,
      rootBranchId: null,
    });
  });

  it("a historical non-empty REAL file without initialFunding becomes funding-consumed", () => {
    const { h, a } = realLedgerWithChild();
    const state = assertStateIntegrity(withoutFunding(h.state), "REAL");
    expect(state.metadata.initialFunding).toMatchObject({
      consumed: true,
      rootBranchId: a.id,
      consumedAt: a.createdAt,
    });
    // A purged root that only survives in the code registry still counts as consumed.
    const onlyCodes = withoutFunding({
      ...createEmptyState("REAL"),
      metadata: { ...createEmptyState("REAL").metadata, reservedCodes: ["A"] },
    });
    expect(assertStateIntegrity(onlyCodes, "REAL").metadata.initialFunding.consumed).toBe(true);
  });

  it("an empty REAL import stays eligible for the €100 seed", () => {
    const file = JSON.parse(JSON.stringify(exportWorkspace(createEmptyState("REAL"))));
    delete file.state.metadata.initialFunding;
    const { state } = prepareImport(file, "REAL");
    expect(state.metadata.initialFunding.consumed).toBe(false);
    const h = workspaceHarness("REAL");
    Object.assign(h.state, state);
    expect(
      createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx()).code,
    ).toBe("A");
  });

  it("historical multiple-root REAL data stays readable but cannot add another root", () => {
    // Build a two-root history (as V1.0 allowed) in DEMO, then relabel it as a REAL ledger.
    const demo = workspaceHarness("DEMO");
    createRootBranch(demo.state, { profile: "HARVEST", capitalCents: 10_000 }, demo.ctx());
    createRootBranch(demo.state, { profile: "GROWTH", capitalCents: 50_000 }, demo.ctx());
    const file = JSON.parse(JSON.stringify(exportWorkspace(demo.state)));
    file.workspace = "REAL";
    file.state.workspace = "REAL";
    delete file.state.metadata.initialFunding;
    const { state } = prepareImport(file, "REAL");
    expect(state.branches.map((b) => b.code)).toEqual(["A", "B"]);
    expect(state.metadata.initialFunding.consumed).toBe(true);
    const h = workspaceHarness("REAL");
    Object.assign(h.state, state);
    expectDomainError(
      () => createRootBranch(h.state, { profile: "HARVEST", capitalCents: 10_000 }, h.ctx()),
      "FUNDING_LOCKED",
    );
    h.expectValid();
  });
});
