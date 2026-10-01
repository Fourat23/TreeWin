import { applyBp, BP_SCALE, calculateReturn, type Cents, type OddsBp } from "../money";
import type { BranchStatus, Profile } from "../types";
import { getProfileRules, type ProfileRules, type StrategySettings } from "./settings";

/** The subset of a branch the rules need to locate its next milestone. */
export interface MilestoneState {
  profile: Profile;
  status: BranchStatus;
  birthCapitalCents: Cents;
  currentCapitalCents: Cents;
  capCents: Cents;
  /** P1 already executed (or skipped because disabled). */
  p1Done: boolean;
  /** Number of post-P1 profile thresholds already harvested. */
  thresholdLevel: number;
  wins: number;
}

export type Milestone =
  | {
      kind: "P1";
      /** Capital needed to fire (null for WIN_COUNT before enough wins are reached). */
      thresholdCents: Cents;
      /** For WIN_COUNT mode: wins required. */
      requiredWins: number | null;
      bankCents: Cents;
      childCents: Cents;
    }
  | { kind: "THRESHOLD"; level: number; multipleBp: number; thresholdCents: Cents }
  | { kind: "CAP"; thresholdCents: Cents }
  | { kind: "NONE" };

/** Value of `start` after `rounds` consecutive wins at `oddsBp`, with real cent rounding. */
export function compoundCapital(start: Cents, oddsBp: OddsBp, rounds: number): Cents {
  let capital = start;
  for (let i = 0; i < rounds; i += 1) capital = calculateReturn(capital, oddsBp);
  return capital;
}

export interface P1Plan {
  /** Capital at which P1 fires (also guarantees the minimum remaining in the mother). */
  thresholdCents: Cents;
  requiredWins: number | null;
  bankCents: Cents;
  childCents: Cents;
  minRemainingCents: Cents;
}

export function planP1(birthCapitalCents: Cents, settings: StrategySettings): P1Plan {
  const { p1 } = settings;
  const bankCents = applyBp(birthCapitalCents, p1.bankMultipleBp);
  const childCents = applyBp(birthCapitalCents, p1.childMultipleBp);
  const minRemainingCents = Math.max(1, applyBp(birthCapitalCents, p1.minMotherRemainingBp));
  const feasibility = bankCents + childCents + minRemainingCents;
  let trigger: Cents;
  let requiredWins: number | null = null;
  switch (p1.trigger) {
    case "TARGET_PATH":
      trigger = compoundCapital(birthCapitalCents, p1.targetOddsBp, p1.targetWins);
      break;
    case "CAPITAL_MULTIPLE":
      trigger = applyBp(birthCapitalCents, p1.capitalMultipleBp);
      break;
    case "WIN_COUNT":
      trigger = 0;
      requiredWins = p1.targetWins;
      break;
  }
  return {
    thresholdCents: Math.max(trigger, feasibility),
    requiredWins,
    bankCents,
    childCents,
    minRemainingCents,
  };
}

/** Multiple (bp) of the `level`-th post-P1 threshold (0-based): first × factor^level. */
export function thresholdMultipleBp(rules: ProfileRules, level: number): number {
  let multiple = BigInt(rules.firstThresholdBp);
  for (let i = 0; i < level; i += 1) {
    multiple = (multiple * BigInt(rules.thresholdFactorBp)) / BigInt(BP_SCALE);
  }
  return Number(multiple);
}

export function thresholdCents(
  birthCapitalCents: Cents,
  rules: ProfileRules,
  level: number,
): Cents {
  return applyBp(birthCapitalCents, thresholdMultipleBp(rules, level));
}

/**
 * Next milestone of a branch, in rule order:
 *   1. P1 (common to every profile, evaluated first even above the cap),
 *   2. the profile's post-P1 thresholds — only those strictly below the cap,
 *   3. the cap itself (maturity).
 * Mature and dead branches have no milestone left.
 */
export function nextMilestone(state: MilestoneState, settings: StrategySettings): Milestone {
  if (state.status === "DEAD" || state.status === "MATURE") return { kind: "NONE" };
  if (settings.p1.enabled && !state.p1Done) {
    const plan = planP1(state.birthCapitalCents, settings);
    return {
      kind: "P1",
      thresholdCents: plan.thresholdCents,
      requiredWins: plan.requiredWins,
      bankCents: plan.bankCents,
      childCents: plan.childCents,
    };
  }
  const rules = getProfileRules(settings, state.profile);
  const multipleBp = thresholdMultipleBp(rules, state.thresholdLevel);
  const target = applyBp(state.birthCapitalCents, multipleBp);
  if (target < state.capCents) {
    return { kind: "THRESHOLD", level: state.thresholdLevel, multipleBp, thresholdCents: target };
  }
  return { kind: "CAP", thresholdCents: state.capCents };
}

export function isMilestoneReached(
  milestone: Milestone,
  capitalCents: Cents,
  wins: number,
): boolean {
  switch (milestone.kind) {
    case "P1":
      return (
        capitalCents >= milestone.thresholdCents &&
        (milestone.requiredWins === null || wins >= milestone.requiredWins)
      );
    case "THRESHOLD":
    case "CAP":
      return capitalCents >= milestone.thresholdCents;
    case "NONE":
      return false;
  }
}
