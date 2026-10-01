/**
 * Core enumerations shared by the domain, the database schema and the UI.
 * Declared as const tuples so they can feed both TypeScript types and Zod/Drizzle enums.
 */

/**
 * Two strictly separate workspaces. REAL holds only genuine, manually entered data and applies
 * the V1 rules strictly; DEMO holds seeded demonstration data and allows explicit experiments.
 */
export const WORKSPACES = ["REAL", "DEMO"] as const;
export type Workspace = (typeof WORKSPACES)[number];

export const PROFILES = ["HARVEST", "BALANCED", "GROWTH"] as const;
export type Profile = (typeof PROFILES)[number];

export const BRANCH_STATUSES = ["ACTIVE", "MATURE", "DEAD", "PAUSED"] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const BET_RESULTS = ["PENDING", "WON", "LOST", "VOID"] as const;
export type BetResult = (typeof BET_RESULTS)[number];

export const SETTLE_RESULTS = ["WON", "LOST", "VOID"] as const;
export type SettleResult = (typeof SETTLE_RESULTS)[number];

export const BRANCH_EVENT_TYPES = [
  "BIRTH",
  "BET_CREATED",
  "BET_WON",
  "BET_LOST",
  "BET_VOID",
  "BET_CANCELLED",
  "HARVEST",
  "BANK_TRANSFER",
  "SPLIT",
  "CHILD_CREATED",
  "CAP_REACHED",
  "PROFILE_CHANGED",
  "STATUS_CHANGED",
  "MANUAL_ADJUSTMENT",
  "DEATH",
] as const;
export type BranchEventType = (typeof BRANCH_EVENT_TYPES)[number];

export const BANK_TX_TYPES = ["HARVEST", "MATURE_PROFIT", "MANUAL"] as const;
export type BankTxType = (typeof BANK_TX_TYPES)[number];

export const BANK_DESTINATIONS = ["UNALLOCATED", "LIVRET_A", "PEA", "CTO", "OTHER"] as const;
export type BankDestination = (typeof BANK_DESTINATIONS)[number];

/**
 * SECURED: the money left the branch ecosystem for good (it may still sit on Winamax).
 * WITHDRAWN: it has actually been withdrawn from Winamax. Neither can ever fund a branch.
 */
export const BANK_STATUSES = ["SECURED", "WITHDRAWN"] as const;
export type BankStatus = (typeof BANK_STATUSES)[number];

export const PROTOCOL_STATUSES = ["ELIGIBLE", "WATCH", "REJECTED", "MANUAL"] as const;
export type ProtocolStatus = (typeof PROTOCOL_STATUSES)[number];

export const CANDIDATE_STATUSES = ["WATCH", "ELIGIBLE", "REJECTED"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** Why money left a branch during a split. */
export const HARVEST_KINDS = ["P1", "THRESHOLD", "MATURE_PROFIT"] as const;
export type HarvestKind = (typeof HARVEST_KINDS)[number];

export const BIRTH_REASONS = ["ROOT", "P1", "THRESHOLD", "MATURE_PROFIT"] as const;
export type BirthReason = (typeof BIRTH_REASONS)[number];

export const BOOKMAKER = "WINAMAX" as const;

export const TRISTATE_VALUES = ["TRUE", "FALSE", "UNKNOWN"] as const;
export type Tristate = (typeof TRISTATE_VALUES)[number];

/** Optional pre-bet protocol checklist. Only `singleMatch` is mandatory (and must be TRUE). */
export const CHECKLIST_ITEMS = [
  "singleMatch",
  "preMatch",
  "oddsInRange",
  "teamStrengthGap",
  "homeAdvantage",
  "lineupKnown",
  "noMajorInjuries",
  "motivationContextOK",
  "scheduleContextOK",
  "marketPriceOK",
  "noCorrelation",
  "noRedFlag",
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];
export type Checklist = Partial<Record<ChecklistItem, Tristate>>;

export type ProfileRecord<T> = Record<Profile, T>;

export function isPlayable(status: BranchStatus): boolean {
  return status === "ACTIVE" || status === "MATURE";
}
