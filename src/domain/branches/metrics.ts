import { BP_SCALE, mulDivRound, type Bp, type Cents } from "../money";
import type { BetResult } from "../types";

export interface LifetimeValueInput {
  currentCapitalCents: Cents;
  totalBankGeneratedCents: Cents;
  totalChildCapitalGeneratedCents: Cents;
}

/**
 * Lifetime value ("Lifetime generated"): what a branch is worth or produced over its life.
 * currentCapital (0 once dead) + everything it sent to BANK + every child it funded.
 */
export function lifetimeValueCents(branch: LifetimeValueInput): Cents {
  return (
    branch.currentCapitalCents +
    branch.totalBankGeneratedCents +
    branch.totalChildCapitalGeneratedCents
  );
}

/** Branch ROI in basis points: (LTV − birth capital) / birth capital. */
export function branchRoiBp(ltvCents: Cents, birthCapitalCents: Cents): Bp {
  if (birthCapitalCents <= 0) return 0;
  return mulDivRound(ltvCents - birthCapitalCents, BP_SCALE, birthCapitalCents);
}

/** Win rate among decided tickets (VOID and PENDING excluded). Null when nothing decided. */
export function winRate(wins: number, losses: number): number | null {
  const decided = wins + losses;
  return decided === 0 ? null : wins / decided;
}

/** Longest run of consecutive WON results (VOID does not break a streak). */
export function bestWinStreak(results: readonly BetResult[]): number {
  let best = 0;
  let current = 0;
  for (const result of results) {
    if (result === "WON") {
      current += 1;
      best = Math.max(best, current);
    } else if (result === "LOST") {
      current = 0;
    }
  }
  return best;
}

export interface LedgerEntry {
  capitalDeltaCents: Cents;
  capitalAfterCents: Cents | null;
}

export interface LedgerCheck {
  balanced: boolean;
  reconstructedCents: Cents;
  storedCents: Cents;
  /** Index of the first event whose running total disagrees with its snapshot. */
  firstMismatchIndex: number | null;
}

/**
 * Re-derive a branch's capital from its event log (Σ capital deltas) and compare it with
 * the stored value and with each event's `capitalAfter` snapshot. This is the audit trail
 * behind "why does this branch hold this amount?".
 */
export function verifyLedger(events: readonly LedgerEntry[], storedCents: Cents): LedgerCheck {
  let running = 0;
  let firstMismatchIndex: number | null = null;
  events.forEach((event, index) => {
    running += event.capitalDeltaCents;
    if (
      firstMismatchIndex === null &&
      event.capitalAfterCents !== null &&
      event.capitalAfterCents !== running
    ) {
      firstMismatchIndex = index;
    }
  });
  return {
    balanced: running === storedCents && firstMismatchIndex === null,
    reconstructedCents: running,
    storedCents,
    firstMismatchIndex,
  };
}
