import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import {
  BANK_DESTINATIONS,
  BANK_TX_TYPES,
  BET_RESULTS,
  BIRTH_REASONS,
  BOOKMAKER,
  BRANCH_EVENT_TYPES,
  BRANCH_STATUSES,
  CANDIDATE_STATUSES,
  HARVEST_KINDS,
  PROFILES,
  PROTOCOL_STATUSES,
  type Checklist,
} from "../../domain/types";

/**
 * SQLite schema. Conventions:
 * - money columns end with `_cents` (INTEGER), odds/ratios with `_bp` (INTEGER basis points)
 * - timestamps are INTEGER epoch milliseconds; match dates are ISO `YYYY-MM-DD` text
 * - nothing financial is ever hard-deleted (tickets are cancelled, candidates archived)
 */

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const money = (name: string) => integer(name).notNull().default(0);

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    parentId: text("parent_id").references((): AnySQLiteColumn => branches.id),
    generation: integer("generation").notNull(),
    profile: text("profile", { enum: PROFILES }).notNull(),
    status: text("status", { enum: BRANCH_STATUSES }).notNull(),
    birthReason: text("birth_reason", { enum: BIRTH_REASONS }).notNull(),
    /** Ticket whose settlement created this branch (null for roots). */
    birthBetId: text("birth_bet_id").references((): AnySQLiteColumn => bets.id),
    birthEventId: integer("birth_event_id"),
    birthCapitalCents: integer("birth_capital_cents").notNull(),
    currentCapitalCents: integer("current_capital_cents").notNull(),
    /** Active-capital cap, snapshotted from settings at birth. */
    capCents: integer("cap_cents").notNull(),
    peakCapitalCents: integer("peak_capital_cents").notNull(),
    p1Done: integer("p1_done", { mode: "boolean" }).notNull().default(false),
    thresholdLevel: integer("threshold_level").notNull().default(0),
    totalBankGeneratedCents: money("total_bank_generated_cents"),
    totalChildCapitalGeneratedCents: money("total_child_capital_generated_cents"),
    totalLostCents: money("total_lost_cents"),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    voids: integer("voids").notNull().default(0),
    roundCount: integer("round_count").notNull().default(0),
    childCount: integer("child_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    maturedAt: timestamp("matured_at"),
    diedAt: timestamp("died_at"),
    lastRoundAt: timestamp("last_round_at"),
    notes: text("notes"),
  },
  (t) => [
    index("branches_parent_idx").on(t.parentId),
    index("branches_status_idx").on(t.status),
    index("branches_profile_idx").on(t.profile),
    check("branches_capital_non_negative", sql`${t.currentCapitalCents} >= 0`),
    check("branches_birth_capital_positive", sql`${t.birthCapitalCents} > 0`),
  ],
);

export const bets = sqliteTable(
  "bets",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    /** Ticket index within the branch (1..n, all tickets including void/cancelled). */
    sequence: integer("sequence").notNull(),
    /** Strategic round number. A VOID ticket does not advance it by default. */
    roundNumber: integer("round_number").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    settledAt: timestamp("settled_at"),
    eventDate: text("event_date").notNull(),
    eventTime: text("event_time"),
    sport: text("sport").notNull(),
    competition: text("competition").notNull(),
    eventName: text("event_name").notNull(),
    /** Normalised match identity used by the same-event protection. */
    eventKey: text("event_key").notNull(),
    homeTeam: text("home_team"),
    awayTeam: text("away_team"),
    marketName: text("market_name").notNull(),
    selection: text("selection").notNull(),
    bookmaker: text("bookmaker", { enum: [BOOKMAKER] })
      .notNull()
      .default(BOOKMAKER),
    oddsBp: integer("odds_bp").notNull(),
    stakeCents: integer("stake_cents").notNull(),
    potentialReturnCents: integer("potential_return_cents").notNull(),
    result: text("result", { enum: BET_RESULTS }).notNull().default("PENDING"),
    actualReturnCents: integer("actual_return_cents"),
    profitLossCents: integer("profit_loss_cents"),
    capitalBeforeCents: integer("capital_before_cents").notNull(),
    /** Branch capital right after the ticket, before harvests. */
    capitalAfterCents: integer("capital_after_cents"),
    countsAsRound: integer("counts_as_round", { mode: "boolean" }),
    closingOddsBp: integer("closing_odds_bp"),
    notes: text("notes"),
    protocolStatus: text("protocol_status", { enum: PROTOCOL_STATUSES }),
    confidence: integer("confidence"),
    checklist: text("checklist", { mode: "json" }).$type<Checklist>(),
    screenshotPath: text("screenshot_path"),
    /** Reason given when a protection (same event, limits) was explicitly overridden. */
    overrideReason: text("override_reason"),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("bets_branch_sequence_uq").on(t.branchId, t.sequence),
    // A branch stakes its capital on one ticket at a time.
    uniqueIndex("bets_one_pending_per_branch_uq")
      .on(t.branchId)
      .where(sql`result = 'PENDING' AND cancelled_at IS NULL`),
    index("bets_event_key_idx").on(t.eventKey),
    index("bets_result_idx").on(t.result),
    index("bets_created_at_idx").on(t.createdAt),
    check("bets_stake_positive", sql`${t.stakeCents} > 0`),
    check("bets_odds_above_one", sql`${t.oddsBp} > 10000`),
  ],
);

export const bankTransactions = sqliteTable(
  "bank_transactions",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    relatedBetId: text("related_bet_id").references(() => bets.id),
    /** Always positive: money only ever flows INTO the BANK. */
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at").notNull(),
    type: text("type", { enum: BANK_TX_TYPES }).notNull(),
    harvestKind: text("harvest_kind", { enum: HARVEST_KINDS }),
    /** Branch profile when the money was secured (provenance by profile). */
    profile: text("profile", { enum: PROFILES }).notNull(),
    destination: text("destination", { enum: BANK_DESTINATIONS }).notNull().default("UNALLOCATED"),
    notes: text("notes"),
  },
  (t) => [
    index("bank_branch_idx").on(t.branchId),
    index("bank_created_at_idx").on(t.createdAt),
    // The BANK only ever receives money: it never flows back into the branches.
    check("bank_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

export const branchEvents = sqliteTable(
  "branch_events",
  {
    /** Monotonic id = global ordering of the event log. */
    id: integer("id").primaryKey({ autoIncrement: true }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    type: text("type", { enum: BRANCH_EVENT_TYPES }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    amountCents: integer("amount_cents"),
    /** Signed effect on the branch capital (Σ deltas = current capital). */
    capitalDeltaCents: integer("capital_delta_cents").notNull().default(0),
    capitalAfterCents: integer("capital_after_cents"),
    statusAfter: text("status_after", { enum: BRANCH_STATUSES }),
    relatedBetId: text("related_bet_id").references(() => bets.id),
    relatedBranchId: text("related_branch_id").references((): AnySQLiteColumn => branches.id),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    description: text("description").notNull(),
  },
  (t) => [
    index("events_branch_idx").on(t.branchId),
    index("events_created_at_idx").on(t.createdAt),
    index("events_type_idx").on(t.type),
  ],
);

export const candidates = sqliteTable(
  "candidates",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    eventDate: text("event_date").notNull(),
    eventTime: text("event_time"),
    sport: text("sport").notNull(),
    competition: text("competition").notNull(),
    eventName: text("event_name").notNull(),
    marketName: text("market_name").notNull(),
    selection: text("selection").notNull(),
    oddsObservedBp: integer("odds_observed_bp").notNull(),
    closingOddsBp: integer("closing_odds_bp"),
    protocolStatus: text("protocol_status", { enum: CANDIDATE_STATUSES }).notNull(),
    result: text("result", { enum: BET_RESULTS }).notNull().default("PENDING"),
    checklist: text("checklist", { mode: "json" }).$type<Checklist>(),
    notes: text("notes"),
    convertedBetId: text("converted_bet_id").references(() => bets.id),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [index("candidates_event_date_idx").on(t.eventDate)],
);

export const strategySettings = sqliteTable("strategy_settings", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const settingsHistory = sqliteTable("settings_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  changedAt: timestamp("changed_at").notNull(),
  note: text("note"),
});

export type BranchRow = typeof branches.$inferSelect;
export type BetRow = typeof bets.$inferSelect;
export type BankTransactionRow = typeof bankTransactions.$inferSelect;
export type BranchEventRow = typeof branchEvents.$inferSelect;
export type NewBranchEventRow = typeof branchEvents.$inferInsert;
export type CandidateRow = typeof candidates.$inferSelect;
