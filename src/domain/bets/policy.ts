import { formatOdds, type Cents, type OddsBp } from "../money";
import { suggestedStakeCents } from "../strategy/engine";
import type { SameEventPolicy, StrategySettings } from "../strategy/settings";
import type { BranchStatus, Profile, Workspace } from "../types";

/**
 * Ticket rules of the V1 strategy, applied before a ticket is recorded.
 *
 * REAL workspace (strict V1):
 *   - the stake MUST be the full strategy stake (whole capital; the capped principal when MATURE)
 *   - odds above `rules.oddsMaxBp` (1.30) are refused
 *   - the same match on two branches is refused when the policy is BLOCK
 *   None of these can be overridden in REAL: if Winamax does not accept the amount, the branch
 *   simply waits — no ticket is mandatory.
 *
 * DEMO workspace: the same rules apply by default, but each violation can be overridden
 * explicitly (with a journaled reason) to run experiments outside the V1 rules.
 *
 * Daily / concurrent ticket limits are personal preferences: overridable in both workspaces.
 */

export type PolicyCode =
  | "STAKE_NOT_FULL"
  | "STAKE_ABOVE_CAPITAL"
  | "ODDS_ABOVE_MAX"
  | "SAME_EVENT"
  | "PENDING_LIMIT"
  | "DAILY_LIMIT";

export interface PolicyViolation {
  code: PolicyCode;
  message: string;
  /** Whether an explicit, journaled override may bypass it in this workspace. */
  overridable: boolean;
}

/** The subset of the strategy settings that governs ticket entry (shared by server and form). */
export interface TicketRules {
  oddsMinBp: number;
  oddsMaxBp: number;
  /** Informational odds corridor of the branch profile. */
  corridor: { minBp: number; maxBp: number };
  sameEventPolicy: SameEventPolicy;
  maxPendingTickets: number | null;
  maxTicketsPerDay: number | null;
}

export function ticketRulesFor(settings: StrategySettings, profile: Profile): TicketRules {
  const profileRules = settings.profiles[profile];
  return {
    oddsMinBp: settings.odds.minBp,
    oddsMaxBp: settings.odds.maxBp,
    corridor: { minBp: profileRules.oddsTargetMinBp, maxBp: profileRules.oddsTargetMaxBp },
    sameEventPolicy: settings.sameEventPolicy,
    maxPendingTickets: settings.limits.maxPendingTickets,
    maxTicketsPerDay: settings.limits.maxTicketsPerDay,
  };
}

export interface TicketPolicyInput {
  workspace: Workspace;
  rules: TicketRules;
  branch: {
    code: string;
    profile: Profile;
    status: BranchStatus;
    currentCapitalCents: Cents;
    capCents: Cents;
  };
  stakeCents: Cents;
  oddsBp: OddsBp;
  sameEventBranchCodes: readonly string[];
  pendingLimitReached: boolean;
  dailyLimitReached: boolean;
}

export interface TicketPolicyResult {
  requiredStakeCents: Cents;
  violations: PolicyViolation[];
  warnings: string[];
}

export function evaluateTicketPolicy(input: TicketPolicyInput): TicketPolicyResult {
  const { workspace, rules, branch } = input;
  const demo = workspace === "DEMO";
  const requiredStakeCents = suggestedStakeCents(branch);
  const violations: PolicyViolation[] = [];
  const warnings: string[] = [];

  if (input.stakeCents > branch.currentCapitalCents) {
    violations.push({
      code: "STAKE_ABOVE_CAPITAL",
      message: `Stake exceeds ${branch.code} capital`,
      overridable: false,
    });
  } else if (input.stakeCents !== requiredStakeCents) {
    violations.push({
      code: "STAKE_NOT_FULL",
      message:
        branch.status === "MATURE"
          ? `${branch.code} is mature: the stake must be its capped principal`
          : `The stake must be the whole capital of ${branch.code} (V1 rule). If Winamax does not accept it, simply wait.`,
      overridable: demo,
    });
  }

  if (input.oddsBp > rules.oddsMaxBp) {
    violations.push({
      code: "ODDS_ABOVE_MAX",
      message: `Odds ${formatOdds(input.oddsBp)} are above the strategy maximum ${formatOdds(rules.oddsMaxBp)}`,
      overridable: demo,
    });
  } else if (input.oddsBp < rules.oddsMinBp) {
    warnings.push(
      `Odds ${formatOdds(input.oddsBp)} below the protocol minimum ${formatOdds(rules.oddsMinBp)}`,
    );
  }

  const { corridor } = rules;
  if (
    input.oddsBp <= rules.oddsMaxBp &&
    (input.oddsBp < corridor.minBp || input.oddsBp > corridor.maxBp)
  ) {
    warnings.push(
      `Outside the ${branch.profile.toLowerCase()} target corridor ${formatOdds(corridor.minBp)}–${formatOdds(
        corridor.maxBp,
      )} (informational)`,
    );
  }

  if (input.sameEventBranchCodes.length > 0) {
    const message = `Same match already pending on ${input.sameEventBranchCodes.join(", ")}`;
    if (rules.sameEventPolicy === "BLOCK") {
      violations.push({
        code: "SAME_EVENT",
        message: `${message}. One branch per match.`,
        overridable: demo,
      });
    } else {
      warnings.push(message);
    }
  }

  if (input.pendingLimitReached) {
    violations.push({
      code: "PENDING_LIMIT",
      message: `Maximum of ${rules.maxPendingTickets} concurrent pending tickets reached`,
      overridable: true,
    });
  }
  if (input.dailyLimitReached) {
    violations.push({
      code: "DAILY_LIMIT",
      message: `Maximum of ${rules.maxTicketsPerDay} tickets per day reached`,
      overridable: true,
    });
  }

  return { requiredStakeCents, violations, warnings };
}
