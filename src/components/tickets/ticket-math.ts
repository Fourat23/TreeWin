import { evaluateTicketPolicy, type PolicyViolation, type TicketRules } from "@/domain/bets/policy";
import { calculateReturn, parseMoney, parseOdds, type Cents } from "@/domain/money";
import type { BranchStatus, Profile, Workspace } from "@/domain/types";

export interface TicketPreview {
  stakeCents: Cents | null;
  oddsBp: number | null;
  potentialReturnCents: Cents | null;
  potentialProfitCents: Cents | null;
  stakeError: string | null;
  oddsError: string | null;
  warnings: string[];
  /** V1 rule violations (same function as the server). Non-overridable ones block the ticket. */
  violations: PolicyViolation[];
}

/**
 * Live ticket calculation shown while typing (pure — same arithmetic and the same V1 policy
 * function as the server, so the form never promises what the server would refuse).
 */
export function computeTicketPreview(input: {
  workspace: Workspace;
  branch: {
    code: string;
    profile: Profile;
    status: BranchStatus;
    currentCapitalCents: Cents;
    capCents: Cents;
  };
  rules: TicketRules;
  stake: string;
  odds: string;
  sameEventBranchCodes?: readonly string[];
  pendingLimitReached?: boolean;
  dailyLimitReached?: boolean;
}): TicketPreview {
  const stakeCents = input.stake.trim() ? parseMoney(input.stake) : null;
  const oddsBp = input.odds.trim() ? parseOdds(input.odds) : null;
  let stakeError: string | null = null;
  let oddsError: string | null = null;

  if (input.stake.trim() && stakeCents === null) stakeError = "Invalid amount";
  else if (stakeCents !== null && stakeCents <= 0) stakeError = "Stake must be positive";
  else if (stakeCents !== null && stakeCents > input.branch.currentCapitalCents) {
    stakeError = "Stake exceeds the branch capital";
  }
  if (input.odds.trim() && oddsBp === null) oddsError = "Odds must be a decimal ≥ 1.01";

  let warnings: string[] = [];
  let violations: PolicyViolation[] = [];
  if (stakeCents !== null && oddsBp !== null && !stakeError && !oddsError) {
    const policy = evaluateTicketPolicy({
      workspace: input.workspace,
      rules: input.rules,
      branch: input.branch,
      stakeCents,
      oddsBp,
      sameEventBranchCodes: input.sameEventBranchCodes ?? [],
      pendingLimitReached: input.pendingLimitReached ?? false,
      dailyLimitReached: input.dailyLimitReached ?? false,
    });
    warnings = policy.warnings;
    violations = policy.violations;
    const oddsViolation = violations.find((v) => v.code === "ODDS_ABOVE_MAX" && !v.overridable);
    if (oddsViolation)
      oddsError = `Above the ${(input.rules.oddsMaxBp / 10_000).toFixed(2)} hard maximum — refused in REAL`;
  }

  const valid =
    stakeCents !== null && stakeCents > 0 && oddsBp !== null && !stakeError && !oddsError;
  const potentialReturnCents = valid ? calculateReturn(stakeCents, oddsBp) : null;
  return {
    stakeCents: stakeError ? null : stakeCents,
    oddsBp,
    potentialReturnCents,
    potentialProfitCents:
      potentialReturnCents !== null && stakeCents !== null
        ? potentialReturnCents - stakeCents
        : null,
    stakeError,
    oddsError,
    warnings,
    violations,
  };
}
