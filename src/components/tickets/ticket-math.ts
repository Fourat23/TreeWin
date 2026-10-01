import { calculateReturn, parseMoney, parseOdds, type Cents } from "@/domain/money";

export interface TicketPreview {
  stakeCents: Cents | null;
  oddsBp: number | null;
  potentialReturnCents: Cents | null;
  potentialProfitCents: Cents | null;
  stakeError: string | null;
  oddsError: string | null;
  warnings: string[];
}

/** Live ticket calculation shown while typing (pure — same arithmetic as the engine). */
export function computeTicketPreview(input: {
  capitalCents: Cents;
  suggestedStakeCents: Cents;
  stake: string;
  odds: string;
  oddsMinBp: number;
  oddsMaxBp: number;
}): TicketPreview {
  const stakeCents = input.stake.trim() ? parseMoney(input.stake) : null;
  const oddsBp = input.odds.trim() ? parseOdds(input.odds) : null;
  let stakeError: string | null = null;
  let oddsError: string | null = null;
  const warnings: string[] = [];

  if (input.stake.trim() && stakeCents === null) stakeError = "Invalid amount";
  else if (stakeCents !== null && stakeCents <= 0) stakeError = "Stake must be positive";
  else if (stakeCents !== null && stakeCents > input.capitalCents)
    stakeError = "Stake exceeds the branch capital";
  else if (stakeCents !== null && stakeCents < input.suggestedStakeCents) {
    warnings.push(
      "Stake below the strategy stake. If lost, the unstaked remainder stays in the branch.",
    );
  }

  if (input.odds.trim() && oddsBp === null) oddsError = "Odds must be a decimal ≥ 1.01";
  else if (oddsBp !== null && (oddsBp < input.oddsMinBp || oddsBp > input.oddsMaxBp)) {
    warnings.push("Odds outside the configured protocol range.");
  }

  const valid = stakeCents !== null && stakeCents > 0 && oddsBp !== null && !stakeError;
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
  };
}
