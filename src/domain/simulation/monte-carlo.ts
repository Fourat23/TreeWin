import {
  emptyProfileCounts,
  pickQuotaProfile,
  type ProfileCounts,
} from "../branches/profile-picker";
import { percentile } from "../analytics/stats";
import { BP_SCALE } from "../money";
import { evaluateSettlement, suggestedStakeCents, type BranchState } from "../strategy/engine";
import type { StrategySettings } from "../strategy/settings";
import type { ProfileRecord } from "../types";

/**
 * Monte Carlo simulation of the whole ecosystem, strictly local and hypothetical.
 * Every simulated round goes through the real rules engine (P1, thresholds, caps, splits),
 * so results always reflect the configured strategy.
 *
 * Model (documented assumptions):
 * - each day, up to `maxDailyTickets` playable branches are drawn at random and stake their
 *   strategy amount on one independent ticket;
 * - a ticket wins with probability `winProbability`; odds are uniform in avg ± spread,
 *   rounded to 0.01 like Winamax quotes;
 * - when `maxBranches` alive branches exist, new children are not created and their capital
 *   is counted in BANK instead (the cap models limited attention, not a rule of the strategy);
 * - no void tickets, no correlation between tickets.
 */

export interface SimulationParams {
  startingCapitalCents: number;
  startingBranches: number;
  winProbability: number;
  averageOddsBp: number;
  oddsSpreadBp: number;
  days: number;
  maxDailyTickets: number;
  maxBranches: number;
  runs: number;
  seed: number;
  /** Profile mix of the starting roots and of automatically created children. */
  profileDistribution: ProfileRecord<number>;
}

export const SIMULATION_LIMITS = {
  maxRuns: 100_000,
  maxDays: 3_650,
  maxBranches: 2_000,
  maxDailyTickets: 200,
  maxStartingBranches: 100,
} as const;

export const BANK_TARGETS_CENTS = [100_000, 500_000, 1_000_000, 5_000_000] as const;

/** Deterministic PRNG (mulberry32) so a seed reproduces a simulation exactly. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface SimBranch extends BranchState {
  alive: boolean;
}

export interface RunResult {
  bankCents: number;
  aliveBranches: number;
  totalBranches: number;
  activeCapitalCents: number;
  extinct: boolean;
  /** BANK at the end of each sampled day (for fan charts). */
  bankByDay: Float64Array | null;
}

function sampleOdds(params: SimulationParams, rng: () => number): number {
  const raw = params.averageOddsBp + (rng() * 2 - 1) * params.oddsSpreadBp;
  return Math.max(10_100, Math.round(raw / 100) * 100);
}

/** One full run. `recordDays` keeps the BANK trajectory (costly; only for a subset of runs). */
export function simulateRun(
  params: SimulationParams,
  settings: StrategySettings,
  rng: () => number,
  recordDays: boolean,
): RunResult {
  const branches: SimBranch[] = [];
  const counts: ProfileCounts = emptyProfileCounts();
  const rootCounts: ProfileCounts = emptyProfileCounts();
  for (let i = 0; i < params.startingBranches; i += 1) {
    const profile = pickQuotaProfile(params.profileDistribution, rootCounts);
    rootCounts[profile] += 1;
    branches.push({
      code: `R${i}`,
      profile,
      status: "ACTIVE",
      birthCapitalCents: params.startingCapitalCents,
      currentCapitalCents: params.startingCapitalCents,
      capCents: Math.max(settings.profiles[profile].capCents, params.startingCapitalCents),
      p1Done: !settings.p1.enabled,
      thresholdLevel: 0,
      wins: 0,
      losses: 0,
      voids: 0,
      roundCount: 0,
      childCount: 0,
      alive: true,
    });
  }
  const strategy: StrategySettings = {
    ...settings,
    profileDistribution: params.profileDistribution,
  };
  let bank = 0;
  let aliveCount = branches.length;
  const bankByDay = recordDays ? new Float64Array(params.days) : null;

  let day = 0;
  for (; day < params.days && aliveCount > 0; day += 1) {
    const playable = branches.filter(
      (b) => b.alive && (b.status === "ACTIVE" || b.status === "MATURE"),
    );
    // Partial Fisher–Yates: draw up to maxDailyTickets distinct branches.
    const draws = Math.min(params.maxDailyTickets, playable.length);
    for (let i = 0; i < draws; i += 1) {
      const j = i + Math.floor(rng() * (playable.length - i));
      const tmp = playable[i] as SimBranch;
      playable[i] = playable[j] as SimBranch;
      playable[j] = tmp;
    }
    for (let i = 0; i < draws; i += 1) {
      const branch = playable[i] as SimBranch;
      const oddsBp = sampleOdds(params, rng);
      const won = rng() < params.winProbability;
      const plan = evaluateSettlement(
        branch,
        { roundNumber: branch.roundCount + 1, stakeCents: suggestedStakeCents(branch), oddsBp },
        won ? "WON" : "LOST",
        strategy,
        { profileCounts: counts, random: rng, quiet: true },
      );
      branch.currentCapitalCents = plan.finalCapitalCents;
      branch.status = plan.status;
      branch.p1Done = plan.p1Done;
      branch.thresholdLevel = plan.thresholdLevel;
      branch.wins = plan.wins;
      branch.losses = plan.losses;
      branch.roundCount = plan.roundCount;
      branch.childCount += plan.children.length;
      bank += plan.totalBankCents;
      if (plan.died) {
        branch.alive = false;
        aliveCount -= 1;
      }
      for (const child of plan.children) {
        if (aliveCount >= params.maxBranches) {
          bank += child.capitalCents;
          continue;
        }
        counts[child.profile] += 1;
        aliveCount += 1;
        branches.push({
          code: child.code,
          profile: child.profile,
          status: "ACTIVE",
          birthCapitalCents: child.capitalCents,
          currentCapitalCents: child.capitalCents,
          capCents: Math.max(settings.profiles[child.profile].capCents, child.capitalCents),
          p1Done: !settings.p1.enabled,
          thresholdLevel: 0,
          wins: 0,
          losses: 0,
          voids: 0,
          roundCount: 0,
          childCount: 0,
          alive: true,
        });
      }
    }
    if (bankByDay) bankByDay[day] = bank;
  }
  // An extinct ecosystem keeps its final BANK for the remaining days.
  if (bankByDay) bankByDay.fill(bank, day);
  const alive = branches.filter((b) => b.alive);
  return {
    bankCents: bank,
    aliveBranches: alive.length,
    totalBranches: branches.length,
    activeCapitalCents: alive.reduce((s, b) => s + b.currentCapitalCents, 0),
    extinct: alive.length === 0,
    bankByDay,
  };
}

export interface SimulationSummary {
  runs: number;
  injectedCents: number;
  bank: {
    mean: number;
    p5: number;
    p25: number;
    median: number;
    p75: number;
    p90: number;
    p95: number;
  };
  probabilityBankAtLeast: { targetCents: number; probability: number }[];
  probabilityExtinct: number;
  probabilityProfit: number;
  medianSurvivingBranches: number;
  medianTotalBranches: number;
  medianActiveCapitalCents: number;
  /** Per-day percentiles of BANK over the recorded subset of runs. */
  fan: { day: number; p10: number; p25: number; p50: number; p75: number; p90: number }[];
  /** Expected value of one ticket at the average odds: p × odds − 1. */
  evPerTicket: number;
}

export function summarize(params: SimulationParams, results: RunResult[]): SimulationSummary {
  const n = results.length;
  const banks = results.map((r) => r.bankCents).sort((a, b) => a - b);
  const q = (p: number) => percentile(banks, p) ?? 0;
  const injected = params.startingCapitalCents * params.startingBranches;
  const sortedNumbers = (values: number[]) => values.sort((a, b) => a - b);
  const recorded = results.filter((r) => r.bankByDay !== null);
  const step = Math.max(1, Math.ceil(params.days / 120));
  const fan: SimulationSummary["fan"] = [];
  for (let day = 0; day < params.days; day += step) {
    const values = sortedNumbers(recorded.map((r) => (r.bankByDay as Float64Array)[day] ?? 0));
    fan.push({
      day: day + 1,
      p10: percentile(values, 0.1) ?? 0,
      p25: percentile(values, 0.25) ?? 0,
      p50: percentile(values, 0.5) ?? 0,
      p75: percentile(values, 0.75) ?? 0,
      p90: percentile(values, 0.9) ?? 0,
    });
  }
  return {
    runs: n,
    injectedCents: injected,
    bank: {
      mean: banks.reduce((s, v) => s + v, 0) / Math.max(1, n),
      p5: q(0.05),
      p25: q(0.25),
      median: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      p95: q(0.95),
    },
    probabilityBankAtLeast: BANK_TARGETS_CENTS.map((targetCents) => ({
      targetCents,
      probability: results.filter((r) => r.bankCents >= targetCents).length / Math.max(1, n),
    })),
    probabilityExtinct: results.filter((r) => r.extinct).length / Math.max(1, n),
    probabilityProfit: results.filter((r) => r.bankCents > injected).length / Math.max(1, n),
    medianSurvivingBranches:
      percentile(sortedNumbers(results.map((r) => r.aliveBranches)), 0.5) ?? 0,
    medianTotalBranches: percentile(sortedNumbers(results.map((r) => r.totalBranches)), 0.5) ?? 0,
    medianActiveCapitalCents:
      percentile(sortedNumbers(results.map((r) => r.activeCapitalCents)), 0.5) ?? 0,
    fan,
    evPerTicket: params.winProbability * (params.averageOddsBp / BP_SCALE) - 1,
  };
}

/** Synchronous driver (used by tests and by the worker in chunks). */
export function runSimulation(
  params: SimulationParams,
  settings: StrategySettings,
  onProgress?: (done: number) => void,
): SimulationSummary {
  const rng = createRng(params.seed);
  const results: RunResult[] = [];
  const recordLimit = 2_000;
  for (let i = 0; i < params.runs; i += 1) {
    results.push(simulateRun(params, settings, rng, i < recordLimit));
    if (onProgress && i % 50 === 0) onProgress(i + 1);
  }
  return summarize(params, results);
}

/** Total simulated tickets (upper bound) — used to warn before very long runs. */
export function estimateWork(
  params: Pick<SimulationParams, "runs" | "days" | "maxDailyTickets">,
): number {
  return params.runs * params.days * params.maxDailyTickets;
}
