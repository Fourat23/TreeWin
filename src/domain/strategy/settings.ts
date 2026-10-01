import { z } from "zod";
import { BP_SCALE } from "../money";
import type { Profile } from "../types";

/**
 * Centralised, versioned strategy configuration.
 *
 * Every rule value used by the engine lives here (and in the `strategy_settings` table) —
 * nothing strategy-related is hard-coded elsewhere. Ratios are basis points (10_000 = 100 %
 * or a 1× multiple), money is integer cents, odds are basis points (1.30 = 13_000).
 */

// Builders with human-readable bounds (values are stored scaled, messages speak in units).
const multiple = (min: number, max: number) =>
  z
    .int()
    .min(min, { error: `Must be at least ${min / BP_SCALE}×` })
    .max(max, { error: `Must be at most ${max / BP_SCALE}×` });
const oddsBounds = (min: number, max: number) =>
  z
    .int()
    .min(min, { error: `Odds must be at least ${(min / BP_SCALE).toFixed(2)}` })
    .max(max, { error: `Odds must be at most ${(max / BP_SCALE).toFixed(2)}` });
const share = z
  .int()
  .min(0, { error: "Must be between 0 and 100 %" })
  .max(BP_SCALE, { error: "Must be between 0 and 100 %" });
const money = (min: number) =>
  z
    .int()
    .min(min, { error: `Must be at least ${(min / 100).toFixed(2)}` })
    .max(100_000_000_000, { error: "Amount too large" });
const count = (min: number, max: number) =>
  z
    .int()
    .min(min, { error: `Must be at least ${min}` })
    .max(max, { error: `Must be at most ${max}` });

export const P1_TRIGGERS = ["TARGET_PATH", "CAPITAL_MULTIPLE", "WIN_COUNT"] as const;
export const CHILD_PROFILE_ASSIGNMENTS = ["QUOTA", "RANDOM", "INHERIT"] as const;
export type ChildProfileAssignment = (typeof CHILD_PROFILE_ASSIGNMENTS)[number];

export const SAME_EVENT_POLICIES = ["BLOCK", "WARN"] as const;
export type SameEventPolicy = (typeof SAME_EVENT_POLICIES)[number];

export const p1SettingsSchema = z
  .object({
    enabled: z.boolean(),
    /**
     * TARGET_PATH: P1 fires when capital ≥ the value S would reach after `targetWins` wins at
     *   `targetOddsBp` (same cent rounding as real tickets). 1.30 × 4 → 2.8561 × S.
     * CAPITAL_MULTIPLE: P1 fires when capital ≥ S × capitalMultipleBp.
     * WIN_COUNT: P1 fires after `targetWins` won rounds, whatever the real odds were.
     * In every mode the split must leave at least `minMotherRemainingBp × S` in the mother.
     */
    trigger: z.enum(P1_TRIGGERS),
    targetOddsBp: oddsBounds(10_100, 100_000),
    targetWins: count(1, 50),
    capitalMultipleBp: multiple(10_000, 1_000_000),
    /** Amount sent to BANK at P1, as a multiple of S (10_000 = 1 × S). */
    bankMultipleBp: multiple(0, 1_000_000),
    /** Capital of the child created at P1, as a multiple of S. */
    childMultipleBp: multiple(0, 1_000_000),
    /** Minimum the mother must keep after P1, as a multiple of S. */
    minMotherRemainingBp: multiple(0, 1_000_000),
  })
  .strict();

export const profileRulesSchema = z
  .object({
    /** First post-P1 threshold, as a multiple of S (40_000 = 4 × S). */
    firstThresholdBp: multiple(10_000, 10_000_000),
    /** Each following threshold = previous × factor (20_000 = doubles). */
    thresholdFactorBp: multiple(10_100, 100_000),
    /** Share of the capital sent to BANK when a threshold is reached. */
    bankShareBp: share,
    /** Share of the capital used to create a child when a threshold is reached. */
    childShareBp: share,
    /** Active-capital cap. Reaching it makes the branch MATURE. */
    capCents: money(100),
  })
  .strict()
  .refine((r) => r.bankShareBp + r.childShareBp < BP_SCALE, {
    error: "BANK share + child share must stay below 100 %",
    path: ["childShareBp"],
  });

export type ProfileRules = z.infer<typeof profileRulesSchema>;

const profileRecord = <T extends z.ZodType>(schema: T) =>
  z.object({ HARVEST: schema, BALANCED: schema, GROWTH: schema }).strict();

export const strategySettingsSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/, { error: "ISO 4217 code, e.g. EUR" }),
    locale: z.string().min(2).max(20),
    roundLabel: z.string().trim().min(1).max(20),
    roundShortLabel: z.string().trim().min(1).max(4),
    profileDistribution: profileRecord(share).refine(
      (d) => d.HARVEST + d.BALANCED + d.GROWTH === BP_SCALE,
      { error: "Profile distribution must total 100 %" },
    ),
    childProfileAssignment: z.enum(CHILD_PROFILE_ASSIGNMENTS),
    p1: p1SettingsSchema,
    profiles: profileRecord(profileRulesSchema),
    mature: z
      .object({
        /** Share of the profit above the cap sent to BANK; the rest creates a child. */
        bankShareBp: share,
      })
      .strict(),
    /** Child amounts below this are sent to BANK instead of creating a dust branch. */
    minChildCapitalCents: money(0),
    odds: z
      .object({ minBp: oddsBounds(10_100, 10_000_000), maxBp: oddsBounds(10_100, 10_000_000) })
      .strict()
      .refine((o) => o.minBp <= o.maxBp, { error: "Min odds must be ≤ max odds", path: ["maxBp"] }),
    limits: z
      .object({
        maxPendingTickets: count(1, 10_000).nullable(),
        maxTicketsPerDay: count(1, 10_000).nullable(),
      })
      .strict(),
    sameEventPolicy: z.enum(SAME_EVENT_POLICIES),
    voidCountsAsRound: z.boolean(),
    analytics: z.object({ minSampleSize: count(1, 10_000) }).strict(),
  })
  .strict();

export type StrategySettings = z.infer<typeof strategySettingsSchema>;

export const DEFAULT_SETTINGS: StrategySettings = {
  currency: "EUR",
  locale: "fr-FR",
  roundLabel: "Round",
  roundShortLabel: "R",
  profileDistribution: { HARVEST: 5_000, BALANCED: 3_500, GROWTH: 1_500 },
  childProfileAssignment: "QUOTA",
  p1: {
    enabled: true,
    trigger: "TARGET_PATH",
    targetOddsBp: 13_000,
    targetWins: 4,
    capitalMultipleBp: 28_561,
    bankMultipleBp: 10_000,
    childMultipleBp: 10_000,
    minMotherRemainingBp: 1_000,
  },
  profiles: {
    HARVEST: {
      firstThresholdBp: 40_000,
      thresholdFactorBp: 20_000,
      bankShareBp: 2_500,
      childShareBp: 2_500,
      capCents: 250_000,
    },
    BALANCED: {
      firstThresholdBp: 60_000,
      thresholdFactorBp: 20_000,
      bankShareBp: 2_000,
      childShareBp: 2_000,
      capCents: 500_000,
    },
    GROWTH: {
      firstThresholdBp: 100_000,
      thresholdFactorBp: 20_000,
      bankShareBp: 1_500,
      childShareBp: 1_500,
      capCents: 1_000_000,
    },
  },
  mature: { bankShareBp: 5_000 },
  minChildCapitalCents: 100,
  odds: { minBp: 11_500, maxBp: 13_500 },
  limits: { maxPendingTickets: null, maxTicketsPerDay: null },
  sameEventPolicy: "BLOCK",
  voidCountsAsRound: false,
  analytics: { minSampleSize: 30 },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge stored values over defaults so new settings keys get sensible values. */
function mergeOverDefaults(defaults: unknown, stored: unknown): unknown {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) {
    return stored === undefined ? defaults : stored;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(defaults)) {
    result[key] = mergeOverDefaults(defaults[key], stored[key]);
  }
  return result;
}

/** Parse settings coming from storage, filling missing keys with defaults. Throws on invalid data. */
export function parseStoredSettings(stored: unknown): StrategySettings {
  return strategySettingsSchema.parse(mergeOverDefaults(DEFAULT_SETTINGS, stored ?? {}));
}

export function getProfileRules(settings: StrategySettings, profile: Profile): ProfileRules {
  return settings.profiles[profile];
}
