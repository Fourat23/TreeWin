import type { BranchStatus, Profile } from "@/domain/types";
import type { BranchEventRecord, BranchRecord } from "./schema";

/**
 * Re-derive every event-driven field of a branch from its own event log.
 *
 * The event log is the source of truth: capital is Σ capitalDelta, counters come from the
 * settlement events, milestones from HARVEST markers, status from the last status snapshot.
 * Used to rebuild a branch after a "delete / rebuild from this point" correction and, by the
 * integrity check, to prove that a stored branch is explained by its history.
 */
export interface ReplayedBranch {
  currentCapitalCents: number;
  peakCapitalCents: number;
  status: BranchStatus;
  profile: Profile;
  capCents: number;
  p1Done: boolean;
  thresholdLevel: number;
  wins: number;
  losses: number;
  voids: number;
  roundCount: number;
  childCount: number;
  totalLostCents: number;
  maturedAt: number | null;
  diedAt: number | null;
  lastRoundAt: number | null;
}

/** Fields compared by the integrity check (bank/child totals are checked separately). */
export const REPLAYED_FIELDS = [
  "status",
  "profile",
  "capCents",
  "p1Done",
  "thresholdLevel",
  "wins",
  "losses",
  "voids",
  "roundCount",
  "totalLostCents",
] as const satisfies readonly (keyof ReplayedBranch)[];

const PROFILE_VALUES = new Set<string>(["HARVEST", "BALANCED", "GROWTH"]);

/** `events` must be the branch's own events, in id order. */
export function replayBranch(
  branch: Pick<BranchRecord, "profile" | "capCents" | "birthCapitalCents">,
  events: readonly BranchEventRecord[],
): ReplayedBranch {
  const out: ReplayedBranch = {
    currentCapitalCents: 0,
    peakCapitalCents: 0,
    status: "ACTIVE",
    profile: branch.profile,
    capCents: branch.capCents,
    p1Done: false,
    thresholdLevel: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    roundCount: 0,
    childCount: 0,
    totalLostCents: 0,
    maturedAt: null,
    diedAt: null,
    lastRoundAt: null,
  };
  for (const event of events) {
    const meta = event.metadata ?? {};
    out.currentCapitalCents += event.capitalDeltaCents;
    if (event.capitalAfterCents !== null) {
      out.peakCapitalCents = Math.max(out.peakCapitalCents, event.capitalAfterCents);
    }
    if (event.statusAfter) out.status = event.statusAfter;
    switch (event.type) {
      case "BIRTH":
        if (typeof meta.profile === "string" && PROFILE_VALUES.has(meta.profile)) {
          out.profile = meta.profile as Profile;
        }
        if (typeof meta.capCents === "number") out.capCents = meta.capCents;
        out.p1Done = meta.p1Done === true;
        break;
      case "BET_WON":
        out.wins += 1;
        out.roundCount += 1;
        out.lastRoundAt = event.createdAt;
        break;
      case "BET_LOST":
        out.losses += 1;
        out.roundCount += 1;
        out.totalLostCents += event.amountCents ?? 0;
        out.lastRoundAt = event.createdAt;
        break;
      case "BET_VOID":
        out.voids += 1;
        if (meta.countsAsRound === true) out.roundCount += 1;
        out.lastRoundAt = event.createdAt;
        break;
      case "HARVEST":
        if (meta.kind === "P1") out.p1Done = true;
        else if (meta.kind === "THRESHOLD") out.thresholdLevel += 1;
        break;
      case "CHILD_CREATED":
        out.childCount += 1;
        break;
      case "CAP_REACHED":
        out.maturedAt = event.createdAt;
        break;
      case "DEATH":
        out.diedAt = event.createdAt;
        break;
      case "PROFILE_CHANGED":
        if (typeof meta.to === "string" && PROFILE_VALUES.has(meta.to))
          out.profile = meta.to as Profile;
        if (typeof meta.capCents === "number") out.capCents = meta.capCents;
        break;
      default:
        break;
    }
  }
  return out;
}
