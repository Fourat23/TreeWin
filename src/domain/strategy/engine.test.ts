import { describe, expect, it } from "vitest";
import { verifyLedger } from "../branches/metrics";
import { emptyProfileCounts } from "../branches/profile-picker";
import type { Profile } from "../types";
import {
  evaluateBranchAfterLoss,
  evaluateBranchAfterVoid,
  evaluateBranchAfterWin,
  evaluateSettlement,
  EngineError,
  suggestedStakeCents,
  type BranchState,
  type EngineContext,
  type SettlementPlan,
} from "./engine";
import { nextMilestone, planP1 } from "./milestones";
import { DEFAULT_SETTINGS, type StrategySettings } from "./settings";

function branch(overrides: Partial<BranchState> = {}): BranchState {
  return {
    code: "A",
    profile: "BALANCED",
    status: "ACTIVE",
    birthCapitalCents: 10_000,
    currentCapitalCents: 10_000,
    capCents: DEFAULT_SETTINGS.profiles.BALANCED.capCents,
    p1Done: false,
    thresholdLevel: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    roundCount: 0,
    childCount: 0,
    ...overrides,
  };
}

const ctx = (overrides: Partial<EngineContext> = {}): EngineContext => ({
  profileCounts: emptyProfileCounts(),
  ...overrides,
});

/** Apply a plan to a state, as the persistence layer does. */
function apply(state: BranchState, plan: SettlementPlan): BranchState {
  return {
    ...state,
    currentCapitalCents: plan.finalCapitalCents,
    status: plan.status,
    p1Done: plan.p1Done,
    thresholdLevel: plan.thresholdLevel,
    wins: plan.wins,
    losses: plan.losses,
    voids: plan.voids,
    roundCount: plan.roundCount,
    childCount: state.childCount + plan.children.length,
  };
}

function winAllIn(state: BranchState, oddsBp: number, settings = DEFAULT_SETTINGS) {
  const plan = evaluateBranchAfterWin(
    state,
    { roundNumber: state.roundCount + 1, stakeCents: suggestedStakeCents(state), oddsBp },
    settings,
    ctx(),
  );
  return { plan, next: apply(state, plan) };
}

describe("rules engine — wins", () => {
  it("simple win: 100 € @1.30 → 130 €", () => {
    const { plan } = winAllIn(branch(), 13_000);
    expect(plan.actualReturnCents).toBe(13_000);
    expect(plan.profitLossCents).toBe(3_000);
    expect(plan.finalCapitalCents).toBe(13_000);
    expect(plan.wins).toBe(1);
    expect(plan.roundCount).toBe(1);
    expect(plan.bankTransfers).toHaveLength(0);
    expect(plan.events.map((e) => e.type)).toEqual(["BET_WON"]);
  });

  it("chains 4 rounds: 100 → 130 → 169 → 219.70 → 285.61, then P1 fires", () => {
    let state = branch();
    const capitals: number[] = [];
    let last: SettlementPlan | null = null;
    for (let i = 0; i < 4; i += 1) {
      const { plan, next } = winAllIn(state, 13_000);
      capitals.push(plan.capitalAfterBetCents);
      state = next;
      last = plan;
    }
    expect(capitals).toEqual([13_000, 16_900, 21_970, 28_561]);
    expect(last).not.toBeNull();
    const p1 = last as SettlementPlan;
    expect(p1.harvests).toHaveLength(1);
    expect(p1.harvests[0]?.kind).toBe("P1");
    expect(p1.totalBankCents).toBe(10_000);
    expect(p1.bankTransfers).toEqual([{ amountCents: 10_000, type: "HARVEST", harvestKind: "P1" }]);
    expect(p1.children).toEqual([
      { code: "A1", profile: "HARVEST", capitalCents: 10_000, reason: "P1" },
    ]);
    expect(p1.finalCapitalCents).toBe(8_561);
    expect(p1.p1Done).toBe(true);
    expect(p1.status).toBe("ACTIVE");
    expect(p1.events.map((e) => e.type)).toEqual([
      "BET_WON",
      "HARVEST",
      "BANK_TRANSFER",
      "CHILD_CREATED",
      "SPLIT",
    ]);
  });

  it("does not fire P1 before the trigger, even after 4 wins at lower real odds", () => {
    let state = branch();
    for (const odds of [12_200, 12_500, 12_700, 12_000]) state = winAllIn(state, odds).next;
    expect(state.p1Done).toBe(false);
    expect(state.currentCapitalCents).toBeLessThan(28_561);
    // A fifth win at 1.30 crosses 285.61 and fires P1 on the real capital.
    const { plan } = winAllIn(state, 13_000);
    expect(plan.capitalAfterBetCents).toBeGreaterThanOrEqual(28_561);
    expect(plan.harvests[0]?.kind).toBe("P1");
    expect(plan.finalCapitalCents).toBe(plan.capitalAfterBetCents - 20_000);
  });

  it("WIN_COUNT trigger fires after N wins whatever the real odds", () => {
    const settings: StrategySettings = {
      ...DEFAULT_SETTINGS,
      p1: { ...DEFAULT_SETTINGS.p1, trigger: "WIN_COUNT" },
    };
    let state = branch();
    let plan: SettlementPlan | undefined;
    for (const odds of [12_500, 12_500, 12_500, 12_500]) {
      ({ plan, next: state } = winAllIn(state, odds, settings));
    }
    // 100 × 1.25^4 = 244.14 → BANK 100, child 100, mother 44.14
    expect(plan?.capitalAfterBetCents).toBe(24_414);
    expect(plan?.finalCapitalCents).toBe(4_414);
  });

  it("CAPITAL_MULTIPLE trigger uses S × multiple", () => {
    const settings: StrategySettings = {
      ...DEFAULT_SETTINGS,
      p1: { ...DEFAULT_SETTINGS.p1, trigger: "CAPITAL_MULTIPLE", capitalMultipleBp: 20_000 },
    };
    expect(planP1(10_000, settings).thresholdCents).toBe(21_000); // max(200, 200 + min 10)
  });

  it("harvests a post-P1 profile threshold (HARVEST 4×S: 25/25/50)", () => {
    const state = branch({
      profile: "HARVEST",
      capCents: DEFAULT_SETTINGS.profiles.HARVEST.capCents,
      p1Done: true,
      currentCapitalCents: 32_000,
    });
    const { plan } = winAllIn(state, 13_000); // 320 → 416 ≥ 400
    expect(plan.capitalAfterBetCents).toBe(41_600);
    expect(plan.harvests[0]).toMatchObject({
      kind: "THRESHOLD",
      level: 0,
      thresholdCents: 40_000,
      bankCents: 10_400,
      childCents: 10_400,
      remainingCents: 20_800,
    });
    expect(plan.thresholdLevel).toBe(1);
    expect(plan.finalCapitalCents).toBe(20_800);
    // Next threshold doubles: 8 × S.
    const milestone = nextMilestone(
      { ...apply(state, plan), currentCapitalCents: plan.finalCapitalCents },
      DEFAULT_SETTINGS,
    );
    expect(milestone).toMatchObject({ kind: "THRESHOLD", thresholdCents: 80_000 });
  });

  it.each<[Profile, number, number, number]>([
    ["HARVEST", 40_000, 2_500, 2_500],
    ["BALANCED", 60_000, 2_000, 2_000],
    ["GROWTH", 100_000, 1_500, 1_500],
  ])("uses %s defaults (first threshold, shares)", (profile, first, bank, child) => {
    const rules = DEFAULT_SETTINGS.profiles[profile];
    expect(rules.firstThresholdBp).toBe(first);
    expect(rules.bankShareBp).toBe(bank);
    expect(rules.childShareBp).toBe(child);
  });

  it("conserves every cent across a split", () => {
    const state = branch({ p1Done: true, currentCapitalCents: 47_777 });
    const { plan } = winAllIn(state, 12_900);
    const h = plan.harvests[0];
    expect(h).toBeDefined();
    if (!h) return;
    expect(h.bankCents + h.childCents + h.remainingCents).toBe(h.capitalBeforeCents);
  });
});

describe("rules engine — cap & maturity", () => {
  it("BALANCED at cap: 5000 @1.30 → 6500, principal 5000, 750 BANK + 750 child", () => {
    const state = branch({
      status: "MATURE",
      p1Done: true,
      thresholdLevel: 3,
      birthCapitalCents: 100_000,
      currentCapitalCents: 500_000,
      childCount: 4,
    });
    const { plan } = winAllIn(state, 13_000);
    expect(plan.capitalAfterBetCents).toBe(650_000);
    expect(plan.profitLossCents).toBe(150_000);
    expect(plan.finalCapitalCents).toBe(500_000);
    expect(plan.status).toBe("MATURE");
    expect(plan.bankTransfers).toEqual([
      { amountCents: 75_000, type: "MATURE_PROFIT", harvestKind: "MATURE_PROFIT" },
    ]);
    expect(plan.children[0]).toMatchObject({ code: "A5", capitalCents: 75_000 });
  });

  it("an ACTIVE branch crossing its cap becomes MATURE and splits the excess", () => {
    const state = branch({
      profile: "HARVEST",
      capCents: 250_000,
      birthCapitalCents: 200_000,
      currentCapitalCents: 200_000,
    });
    const { plan } = winAllIn(state, 13_000); // 2000 → 2600 ≥ 2500, P1 (5712) not reached
    expect(plan.matured).toBe(true);
    expect(plan.status).toBe("MATURE");
    expect(plan.finalCapitalCents).toBe(250_000);
    expect(plan.totalBankCents).toBe(5_000);
    expect(plan.totalChildCapitalCents).toBe(5_000);
    expect(plan.events.map((e) => e.type)).toContain("CAP_REACHED");
  });

  it("evaluates P1 before the cap", () => {
    const state = branch({
      profile: "HARVEST",
      capCents: 250_000,
      birthCapitalCents: 100_000,
      currentCapitalCents: 219_700,
      wins: 3,
      roundCount: 3,
    });
    const { plan } = winAllIn(state, 13_000); // 2856.10 → P1 → 856.10
    expect(plan.harvests.map((h) => h.kind)).toEqual(["P1"]);
    expect(plan.finalCapitalCents).toBe(85_610);
    expect(plan.status).toBe("ACTIVE");
  });

  it("ignores profile thresholds at or above the cap", () => {
    const state = branch({
      profile: "HARVEST",
      capCents: 250_000,
      p1Done: true,
      thresholdLevel: 3, // next threshold would be 32 × S = 3 200 € > cap
      currentCapitalCents: 240_000,
    });
    expect(nextMilestone(state, DEFAULT_SETTINGS)).toEqual({
      kind: "CAP",
      thresholdCents: 250_000,
    });
    const { plan } = winAllIn(state, 13_000);
    expect(plan.harvests.map((h) => h.kind)).toEqual(["MATURE_PROFIT"]);
  });

  it("suggests the cap as stake for mature branches", () => {
    expect(
      suggestedStakeCents({ status: "MATURE", currentCapitalCents: 500_000, capCents: 500_000 }),
    ).toBe(500_000);
    expect(
      suggestedStakeCents({ status: "ACTIVE", currentCapitalCents: 28_561, capCents: 500_000 }),
    ).toBe(28_561);
  });
});

describe("rules engine — loss & void", () => {
  it("a lost all-in ticket kills the branch", () => {
    const state = branch({ currentCapitalCents: 16_900, wins: 2, roundCount: 2 });
    const plan = evaluateBranchAfterLoss(
      state,
      { roundNumber: 3, stakeCents: 16_900, oddsBp: 12_500 },
      DEFAULT_SETTINGS,
      ctx(),
    );
    expect(plan.finalCapitalCents).toBe(0);
    expect(plan.status).toBe("DEAD");
    expect(plan.died).toBe(true);
    expect(plan.losses).toBe(1);
    expect(plan.roundCount).toBe(3);
    expect(plan.lostCents).toBe(16_900);
    expect(plan.bankTransfers).toHaveLength(0);
    expect(plan.events.map((e) => e.type)).toEqual(["BET_LOST", "DEATH"]);
    expect(plan.events.at(-1)?.statusAfter).toBe("DEAD");
  });

  it("a partial stake loss keeps the un-staked remainder alive", () => {
    const plan = evaluateBranchAfterLoss(
      branch(),
      { roundNumber: 1, stakeCents: 8_000, oddsBp: 12_500 },
      DEFAULT_SETTINGS,
      ctx(),
    );
    expect(plan.finalCapitalCents).toBe(2_000);
    expect(plan.status).toBe("ACTIVE");
    expect(plan.died).toBe(false);
  });

  it("void restores the capital and does not advance the round by default", () => {
    const state = branch({ currentCapitalCents: 16_900, wins: 2, roundCount: 2 });
    const plan = evaluateBranchAfterVoid(
      state,
      { roundNumber: 3, stakeCents: 16_900, oddsBp: 13_000 },
      DEFAULT_SETTINGS,
      ctx(),
    );
    expect(plan.finalCapitalCents).toBe(16_900);
    expect(plan.voids).toBe(1);
    expect(plan.roundCount).toBe(2);
    expect(plan.wins).toBe(2);
    expect(plan.countsAsRound).toBe(false);
  });

  it("void can be configured to count as a round", () => {
    const plan = evaluateBranchAfterVoid(
      branch(),
      { roundNumber: 1, stakeCents: 10_000, oddsBp: 13_000 },
      { ...DEFAULT_SETTINGS, voidCountsAsRound: true },
      ctx(),
    );
    expect(plan.roundCount).toBe(1);
  });

  it("refuses to settle dead or paused branches and oversized stakes", () => {
    const ticket = { roundNumber: 1, stakeCents: 10_000, oddsBp: 13_000 };
    expect(() =>
      evaluateSettlement(branch({ status: "DEAD" }), ticket, "WON", DEFAULT_SETTINGS, ctx()),
    ).toThrow(EngineError);
    expect(() =>
      evaluateSettlement(branch({ status: "PAUSED" }), ticket, "WON", DEFAULT_SETTINGS, ctx()),
    ).toThrow(EngineError);
    expect(() =>
      evaluateSettlement(
        branch(),
        { ...ticket, stakeCents: 10_001 },
        "WON",
        DEFAULT_SETTINGS,
        ctx(),
      ),
    ).toThrow(/exceeds/);
  });
});

describe("rules engine — children & audit", () => {
  it("honours explicit child profile overrides", () => {
    const state = branch({ currentCapitalCents: 21_970, wins: 3, roundCount: 3 });
    const plan = evaluateBranchAfterWin(
      state,
      { roundNumber: 4, stakeCents: 21_970, oddsBp: 13_000 },
      DEFAULT_SETTINGS,
      ctx({ childProfileOverrides: ["GROWTH"] }),
    );
    expect(plan.children[0]?.profile).toBe("GROWTH");
  });

  it("names children after the existing ones (codes are never reused)", () => {
    const state = branch({ code: "A2", currentCapitalCents: 21_970, wins: 3, childCount: 2 });
    const { plan } = winAllIn(state, 13_000);
    expect(plan.children[0]?.code).toBe("A2.3");
  });

  it("redirects dust children to BANK", () => {
    const settings = { ...DEFAULT_SETTINGS, minChildCapitalCents: 20_000 };
    const state = branch({ currentCapitalCents: 21_970, wins: 3 });
    const { plan } = winAllIn(state, 13_000, settings);
    expect(plan.children).toHaveLength(0);
    expect(plan.totalBankCents).toBe(20_000);
    expect(plan.harvests[0]?.childRedirectedToBank).toBe(true);
  });

  it("produces events whose deltas explain the final capital", () => {
    let state = branch();
    const ledger = [{ capitalDeltaCents: 10_000, capitalAfterCents: 10_000 }];
    for (let i = 0; i < 4; i += 1) {
      const { plan, next } = winAllIn(state, 13_000);
      ledger.push(...plan.events);
      state = next;
    }
    expect(verifyLedger(ledger, state.currentCapitalCents)).toMatchObject({
      balanced: true,
      reconstructedCents: 8_561,
    });
  });
});

describe("V1.1 rules", () => {
  it("defaults P1 to CAPITAL_MULTIPLE 2.80 × S", () => {
    expect(DEFAULT_SETTINGS.p1.trigger).toBe("CAPITAL_MULTIPLE");
    expect(DEFAULT_SETTINGS.p1.capitalMultipleBp).toBe(28_000);
    expect(planP1(10_000, DEFAULT_SETTINGS).thresholdCents).toBe(28_000);
    // Exactly 280 € fires P1 for S = 100 €.
    const { plan } = winAllIn(
      branch({ currentCapitalCents: 21_540, wins: 3, roundCount: 3 }),
      13_000,
    );
    expect(plan.capitalAfterBetCents).toBe(28_002);
    expect(plan.harvests.map((h) => h.kind)).toEqual(["P1"]);
  });

  it("keeps the 100 → 285.61 acceptance path: BANK 100, child 100, mother 85.61", () => {
    let state = branch();
    let last: SettlementPlan | null = null;
    for (let i = 0; i < 4; i += 1) ({ plan: last, next: state } = winAllIn(state, 13_000));
    expect(last?.capitalAfterBetCents).toBe(28_561);
    expect(last?.totalBankCents).toBe(10_000);
    expect(last?.totalChildCapitalCents).toBe(10_000);
    expect(last?.finalCapitalCents).toBe(8_561);
  });

  it("executes at most one profile threshold per won round", () => {
    const state = branch({
      profile: "HARVEST",
      capCents: 250_000,
      p1Done: true,
      currentCapitalCents: 70_000,
    });
    const { plan, next } = winAllIn(state, 13_000); // 910 € ≥ 4×S and ≥ 8×S
    expect(plan.harvests.map((h) => h.kind)).toEqual(["THRESHOLD"]);
    expect(plan.thresholdLevel).toBe(1);
    expect(plan.finalCapitalCents).toBe(45_500);
    // The next threshold (8×S = 800 €) waits for a later won round.
    expect(nextMilestone(next, DEFAULT_SETTINGS)).toMatchObject({
      kind: "THRESHOLD",
      thresholdCents: 80_000,
    });
  });

  it("does not add a profile threshold in the round where P1 executes", () => {
    const state = branch({ profile: "HARVEST", capCents: 250_000, currentCapitalCents: 60_000 });
    const { plan } = winAllIn(state, 13_000); // 780 €: P1, then still ≥ 4×S
    expect(plan.harvests.map((h) => h.kind)).toEqual(["P1"]);
    expect(plan.finalCapitalCents).toBe(58_000);
    expect(plan.thresholdLevel).toBe(0);
  });
});
