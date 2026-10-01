import { BP_SCALE } from "../money";
import type { ChildProfileAssignment, StrategySettings } from "../strategy/settings";
import { PROFILES, type Profile, type ProfileRecord } from "../types";

export type ProfileCounts = ProfileRecord<number>;

export function emptyProfileCounts(): ProfileCounts {
  return { HARVEST: 0, BALANCED: 0, GROWTH: 0 };
}

/**
 * Deterministic quota assignment ("largest deficit").
 *
 * Picks the profile whose target share is furthest ahead of its actual count, i.e.
 * argmax(weight × (n + 1) − count). Over time the population converges exactly to the
 * configured distribution (50 / 35 / 15 by default) without randomness, which keeps the
 * engine reproducible and testable. Ties resolve in HARVEST → BALANCED → GROWTH order.
 */
export function pickQuotaProfile(
  distribution: ProfileRecord<number>,
  counts: ProfileCounts,
): Profile {
  const total = PROFILES.reduce((sum, p) => sum + counts[p], 0);
  let best: Profile | null = null;
  let bestDeficit = -Infinity;
  for (const profile of PROFILES) {
    const weight = distribution[profile];
    if (weight <= 0) continue;
    const deficit = (weight * (total + 1)) / BP_SCALE - counts[profile];
    if (deficit > bestDeficit + 1e-9) {
      best = profile;
      bestDeficit = deficit;
    }
  }
  return best ?? "BALANCED";
}

/** Weighted random draw, `random` must return a float in [0, 1). */
export function pickRandomProfile(
  distribution: ProfileRecord<number>,
  random: () => number,
): Profile {
  const total = PROFILES.reduce((sum, p) => sum + distribution[p], 0);
  if (total <= 0) return "BALANCED";
  let threshold = random() * total;
  for (const profile of PROFILES) {
    threshold -= distribution[profile];
    if (threshold < 0) return profile;
  }
  return PROFILES[PROFILES.length - 1] ?? "BALANCED";
}

export interface PickChildProfileInput {
  mode: ChildProfileAssignment;
  distribution: StrategySettings["profileDistribution"];
  counts: ProfileCounts;
  parentProfile: Profile;
  random?: () => number;
}

export function pickChildProfile(input: PickChildProfileInput): Profile {
  switch (input.mode) {
    case "INHERIT":
      return input.parentProfile;
    case "RANDOM":
      return pickRandomProfile(input.distribution, input.random ?? Math.random);
    case "QUOTA":
      return pickQuotaProfile(input.distribution, input.counts);
  }
}
