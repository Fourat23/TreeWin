import {
  mean,
  median,
  summarizeTickets,
  type TicketGroupStats,
  type TicketSample,
} from "@/domain/analytics/stats";
import { clvBp, oddsBucketOf, ODDS_BUCKETS } from "@/domain/bets/tickets";
import { branchRoiBp, lifetimeValueCents } from "@/domain/branches/metrics";
import { CANDIDATE_STATUSES, PROFILES, type CandidateStatus, type Profile } from "@/domain/types";
import type { WorkspaceState } from "../state/schema";

const DAY_MS = 86_400_000;

export interface Distribution {
  mean: number | null;
  median: number | null;
}

const dist = (values: number[]): Distribution => ({ mean: mean(values), median: median(values) });

export interface ProfileAnalytics {
  profile: Profile;
  branches: number;
  alive: number;
  dead: number;
  mature: number;
  winRate: number | null;
  roundsPlayed: Distribution;
  survivalRounds: Distribution;
  daysToDeath: Distribution;
  bankPerBranchCents: Distribution;
  peakCapitalCents: { max: number | null; median: number | null };
  children: Distribution;
  roiBp: Distribution;
}

export interface TicketBreakdownRow extends TicketGroupStats {
  key: string;
  label: string;
}

export interface AnalyticsDTO {
  minSample: number;
  profiles: ProfileAnalytics[];
  global: TicketGroupStats;
  bySport: TicketBreakdownRow[];
  byOddsBucket: TicketBreakdownRow[];
  byProfile: TicketBreakdownRow[];
  byCompetition: TicketBreakdownRow[];
  candidates: CandidateStats[];
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function getAnalytics(state: WorkspaceState): AnalyticsDTO {
  const minSample = state.settings.analytics.minSampleSize;
  const branchRows = state.branches;

  const profiles = PROFILES.map((profile): ProfileAnalytics => {
    const rows = branchRows.filter((b) => b.profile === profile);
    const dead = rows.filter((b) => b.status === "DEAD");
    const wins = rows.reduce((s, b) => s + b.wins, 0);
    const losses = rows.reduce((s, b) => s + b.losses, 0);
    return {
      profile,
      branches: rows.length,
      alive: rows.length - dead.length,
      dead: dead.length,
      mature: rows.filter((b) => b.status === "MATURE").length,
      winRate: wins + losses > 0 ? wins / (wins + losses) : null,
      roundsPlayed: dist(rows.map((b) => b.roundCount)),
      survivalRounds: dist(dead.map((b) => b.roundCount)),
      daysToDeath: dist(
        dead
          .filter((b) => b.diedAt !== null)
          .map((b) => ((b.diedAt as number) - b.createdAt) / DAY_MS),
      ),
      bankPerBranchCents: dist(rows.map((b) => b.totalBankGeneratedCents)),
      peakCapitalCents: {
        max: rows.length ? Math.max(...rows.map((b) => b.peakCapitalCents)) : null,
        median: median(rows.map((b) => b.peakCapitalCents)),
      },
      children: dist(rows.map((b) => b.childCount)),
      roiBp: dist(rows.map((b) => branchRoiBp(lifetimeValueCents(b), b.birthCapitalCents))),
    };
  });

  const profileOf = new Map(branchRows.map((b) => [b.id, b.profile]));
  const ticketRows = state.bets
    .filter((b) => b.cancelledAt === null && profileOf.has(b.branchId))
    .map((b) => ({
      result: b.result,
      oddsBp: b.oddsBp,
      stakeCents: b.stakeCents,
      profitLossCents: b.profitLossCents,
      closingOddsBp: b.closingOddsBp,
      sport: b.sport,
      competition: b.competition,
      profile: profileOf.get(b.branchId) as Profile,
    }));
  const samples = ticketRows.map((r) => ({
    ...r,
    clvBp: clvBp(r.oddsBp, r.closingOddsBp),
  }));

  const breakdown = (
    keyOf: (s: (typeof samples)[number]) => string,
    labelOf: (key: string) => string = (k) => k,
  ) =>
    [...groupBy(samples, keyOf).entries()]
      .map(([key, group]): TicketBreakdownRow => ({
        key,
        label: labelOf(key),
        ...summarizeTickets(group, minSample),
      }))
      .sort((a, b) => b.tickets - a.tickets);

  const bucketOrder = new Map(ODDS_BUCKETS.map((b, i) => [b.id, i]));

  return {
    minSample,
    profiles,
    global: summarizeTickets(samples, minSample),
    bySport: breakdown((s) => s.sport),
    byOddsBucket: breakdown(
      (s) => oddsBucketOf(s.oddsBp).id,
      (id) => ODDS_BUCKETS.find((b) => b.id === id)?.label ?? id,
    ).sort((a, b) => (bucketOrder.get(a.key) ?? 0) - (bucketOrder.get(b.key) ?? 0)),
    byProfile: breakdown((s) => s.profile),
    byCompetition: breakdown((s) => s.competition),
    candidates: getCandidateStats(state, minSample),
  };
}

export type CandidateStats = TicketGroupStats & { status: CandidateStatus };

/** Shadow-portfolio performance per protocol status, at a flat 1-unit stake. */
export function getCandidateStats(state: WorkspaceState, minSample: number): CandidateStats[] {
  const candidateRows = state.candidates.filter((c) => c.archivedAt === null);
  return CANDIDATE_STATUSES.map((status) => {
    const group: TicketSample[] = candidateRows
      .filter((c) => c.protocolStatus === status)
      .map((c) => ({
        result: c.result,
        oddsBp: c.oddsObservedBp,
        stakeCents: c.result === "PENDING" ? 0 : 100,
        profitLossCents:
          c.result === "WON"
            ? Math.round((c.oddsObservedBp - 10_000) / 100)
            : c.result === "LOST"
              ? -100
              : c.result === "VOID"
                ? 0
                : null,
        clvBp: clvBp(c.oddsObservedBp, c.closingOddsBp),
      }));
    return { status, ...summarizeTickets(group, minSample) };
  });
}
