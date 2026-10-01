import { BP_SCALE } from "../money";

/**
 * Small, dependency-free statistics used by analytics. Every helper is defensive about
 * empty input and returns null rather than a misleading 0.
 */

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** Linear-interpolated percentile, p in [0, 1]. */
export function percentile(sortedValues: readonly number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = (sortedValues.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const a = sortedValues[lo] as number;
  const b = sortedValues[hi] as number;
  return a + (b - a) * (index - lo);
}

/**
 * Wilson score interval for a binomial proportion (95 % by default). Much better than the
 * normal approximation for small samples and proportions close to 1 (typical here: 75–85 %).
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96,
): { low: number; high: number } | null {
  if (trials === 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export interface TicketSample {
  result: "WON" | "LOST" | "VOID" | "PENDING";
  oddsBp: number;
  stakeCents: number;
  profitLossCents: number | null;
  clvBp: number | null;
}

export interface TicketGroupStats {
  tickets: number;
  decided: number;
  wins: number;
  losses: number;
  voids: number;
  winRate: number | null;
  winRateInterval: { low: number; high: number } | null;
  avgOdds: number | null;
  /** Mean of 1/odds over decided tickets: the win rate needed to break even. */
  breakEven: number | null;
  /** winRate − breakEven, only when the sample is large enough to say anything. */
  edge: number | null;
  significant: boolean;
  stakeCents: number;
  profitCents: number;
  /** Realised yield = profit / stake on settled tickets. */
  yield: number | null;
  avgClvBp: number | null;
  clvSample: number;
}

/**
 * Aggregate ticket performance. `edge` is withheld below `minSample` decided tickets: with
 * 75–85 % win rates, a few dozen results cannot separate skill from luck.
 */
export function summarizeTickets(
  samples: readonly TicketSample[],
  minSample: number,
): TicketGroupStats {
  const settled = samples.filter((s) => s.result !== "PENDING");
  const decided = settled.filter((s) => s.result === "WON" || s.result === "LOST");
  const wins = decided.filter((s) => s.result === "WON").length;
  const losses = decided.length - wins;
  const winRate = decided.length > 0 ? wins / decided.length : null;
  const breakEven = mean(decided.map((s) => BP_SCALE / s.oddsBp));
  const significant = decided.length >= minSample;
  const stakeCents = settled.reduce((sum, s) => sum + s.stakeCents, 0);
  const profitCents = settled.reduce((sum, s) => sum + (s.profitLossCents ?? 0), 0);
  const clv = samples.map((s) => s.clvBp).filter((v): v is number => v !== null);
  return {
    tickets: samples.length,
    decided: decided.length,
    wins,
    losses,
    voids: settled.length - decided.length,
    winRate,
    winRateInterval: wilsonInterval(wins, decided.length),
    avgOdds: mean(samples.map((s) => s.oddsBp / BP_SCALE)),
    breakEven,
    edge: significant && winRate !== null && breakEven !== null ? winRate - breakEven : null,
    significant,
    stakeCents,
    profitCents,
    yield: stakeCents > 0 ? profitCents / stakeCents : null,
    avgClvBp: clv.length > 0 ? Math.round(mean(clv) as number) : null,
    clvSample: clv.length,
  };
}
