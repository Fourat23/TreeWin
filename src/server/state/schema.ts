import { z } from "zod";
import { strategySettingsSchema } from "@/domain/strategy/settings";
import {
  BANK_DESTINATIONS,
  BANK_STATUSES,
  BANK_TX_TYPES,
  BET_RESULTS,
  BIRTH_REASONS,
  BOOKMAKER,
  BRANCH_EVENT_TYPES,
  BRANCH_STATUSES,
  CANDIDATE_STATUSES,
  CHECKLIST_ITEMS,
  HARVEST_KINDS,
  PROFILES,
  PROTOCOL_STATUSES,
  TRISTATE_VALUES,
  WORKSPACES,
} from "@/domain/types";

/**
 * Versioned on-disk format of a workspace (data/<workspace>/state.json).
 *
 * Conventions: money = integer cents (`*Cents`), odds/ratios = integer basis points (`*Bp`),
 * timestamps = epoch milliseconds, match days = ISO `YYYY-MM-DD`. Records are plain JSON so the
 * file can be read, diffed and backed up by hand.
 */

export const STATE_FORMAT = "celltree-state";
export const STATE_SCHEMA_VERSION = 1;

const ms = z.number().int().nonnegative();
const nullableMs = ms.nullable();
const int = z.number().int();
const id = z.string().min(1).max(64);
const checklist = z.partialRecord(z.enum(CHECKLIST_ITEMS), z.enum(TRISTATE_VALUES)).nullable();

export const branchRecordSchema = z
  .object({
    id,
    code: z.string().min(1).max(64),
    parentId: id.nullable(),
    generation: int.min(0),
    profile: z.enum(PROFILES),
    status: z.enum(BRANCH_STATUSES),
    birthReason: z.enum(BIRTH_REASONS),
    /** Ticket whose settlement created this branch (null for roots). */
    birthBetId: id.nullable(),
    birthEventId: int.nullable(),
    birthCapitalCents: int.positive(),
    currentCapitalCents: int.min(0),
    /** Active-capital cap, snapshotted at birth. */
    capCents: int.positive(),
    peakCapitalCents: int.min(0),
    p1Done: z.boolean(),
    thresholdLevel: int.min(0),
    totalBankGeneratedCents: int.min(0),
    totalChildCapitalGeneratedCents: int.min(0),
    totalLostCents: int.min(0),
    wins: int.min(0),
    losses: int.min(0),
    voids: int.min(0),
    roundCount: int.min(0),
    /** Children ever created (child codes are allocated from it). */
    childCount: int.min(0),
    createdAt: ms,
    updatedAt: ms,
    maturedAt: nullableMs,
    diedAt: nullableMs,
    lastRoundAt: nullableMs,
    notes: z.string().nullable(),
    strategyVersion: z.string(),
    strategyRevision: int.min(0),
  })
  .strict();

export const betRecordSchema = z
  .object({
    id,
    branchId: id,
    /** Ticket index within the branch (all tickets, including void/cancelled). */
    sequence: int.positive(),
    /** Strategic round number (a VOID ticket does not advance it by default). */
    roundNumber: int.positive(),
    createdAt: ms,
    updatedAt: ms,
    settledAt: nullableMs,
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    eventTime: z.string().nullable(),
    sport: z.string(),
    competition: z.string(),
    eventName: z.string().min(1),
    /** Normalised match identity used by the one-branch-per-match protection. */
    eventKey: z.string().min(1),
    homeTeam: z.string().nullable(),
    awayTeam: z.string().nullable(),
    marketName: z.string().min(1),
    selection: z.string().min(1),
    bookmaker: z.literal(BOOKMAKER),
    oddsBp: int.gt(10_000),
    stakeCents: int.positive(),
    potentialReturnCents: int.positive(),
    result: z.enum(BET_RESULTS),
    actualReturnCents: int.nullable(),
    profitLossCents: int.nullable(),
    capitalBeforeCents: int.min(0),
    /** Branch capital right after the ticket, before harvests. */
    capitalAfterCents: int.nullable(),
    countsAsRound: z.boolean().nullable(),
    closingOddsBp: int.nullable(),
    notes: z.string().nullable(),
    protocolStatus: z.enum(PROTOCOL_STATUSES).nullable(),
    confidence: int.min(1).max(5).nullable(),
    checklist,
    screenshotPath: z.string().nullable(),
    /** Reason given when an explicit override bypassed a protection. */
    overrideReason: z.string().nullable(),
    /** True when a V1 strategy rule was bypassed (DEMO-only experiment). */
    outsideV1: z.boolean(),
    cancelledAt: nullableMs,
    cancelReason: z.string().nullable(),
    strategyVersion: z.string(),
    strategyRevision: int.min(0),
  })
  .strict();

export const bankTransactionRecordSchema = z
  .object({
    id,
    branchId: id,
    relatedBetId: id.nullable(),
    /** Always positive: money only ever flows INTO the BANK. */
    amountCents: int.positive(),
    createdAt: ms,
    type: z.enum(BANK_TX_TYPES),
    harvestKind: z.enum(HARVEST_KINDS).nullable(),
    /** Branch profile when the money was secured (provenance by profile). */
    profile: z.enum(PROFILES),
    status: z.enum(BANK_STATUSES),
    withdrawnAt: nullableMs,
    destination: z.enum(BANK_DESTINATIONS),
    notes: z.string().nullable(),
  })
  .strict();

export const branchEventRecordSchema = z
  .object({
    /** Monotonic id = global order of the event log. */
    id: int.positive(),
    branchId: id,
    type: z.enum(BRANCH_EVENT_TYPES),
    createdAt: ms,
    amountCents: int.nullable(),
    /** Signed effect on the branch capital (Σ deltas = current capital). */
    capitalDeltaCents: int,
    capitalAfterCents: int.nullable(),
    statusAfter: z.enum(BRANCH_STATUSES).nullable(),
    relatedBetId: id.nullable(),
    relatedBranchId: id.nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    description: z.string(),
  })
  .strict();

export const candidateRecordSchema = z
  .object({
    id,
    createdAt: ms,
    updatedAt: ms,
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    eventTime: z.string().nullable(),
    sport: z.string(),
    competition: z.string(),
    eventName: z.string().min(1),
    marketName: z.string(),
    selection: z.string(),
    oddsObservedBp: int.gt(10_000),
    closingOddsBp: int.nullable(),
    protocolStatus: z.enum(CANDIDATE_STATUSES),
    result: z.enum(BET_RESULTS),
    checklist,
    notes: z.string().nullable(),
    convertedBetId: id.nullable(),
    archivedAt: nullableMs,
  })
  .strict();

export const settingsHistoryEntrySchema = z
  .object({
    id: int.positive(),
    changedAt: ms,
    note: z.string().nullable(),
    /** Strategy revision that the stored settings belonged to. */
    revision: int.min(0),
    data: z.unknown(),
  })
  .strict();

/** Soft-deleted records, kept out of the ledger but recoverable from snapshots / inspection. */
export const archiveEntrySchema = z
  .object({
    id,
    at: ms,
    label: z.string(),
    branches: z.array(branchRecordSchema),
    bets: z.array(betRecordSchema),
    bankTransactions: z.array(bankTransactionRecordSchema),
    branchEvents: z.array(branchEventRecordSchema),
    candidates: z.array(candidateRecordSchema),
  })
  .strict();

export const lastChangeSchema = z
  .object({
    label: z.string(),
    /** Snapshot taken immediately before the change — restoring it undoes the change. */
    backupId: z.string(),
    at: ms,
    /** Mutation counter right after the change (later mutations are also undone). */
    mutationCount: int.min(0),
  })
  .strict();

export const workspaceStateSchema = z
  .object({
    format: z.literal(STATE_FORMAT),
    schemaVersion: z.literal(STATE_SCHEMA_VERSION),
    workspace: z.enum(WORKSPACES),
    strategyVersion: z.string(),
    savedAt: z.string(),
    settings: strategySettingsSchema,
    settingsHistory: z.array(settingsHistoryEntrySchema),
    branches: z.array(branchRecordSchema),
    bets: z.array(betRecordSchema),
    bankTransactions: z.array(bankTransactionRecordSchema),
    branchEvents: z.array(branchEventRecordSchema),
    candidates: z.array(candidateRecordSchema),
    archive: z.array(archiveEntrySchema),
    metadata: z
      .object({
        createdAt: ms,
        nextEventId: int.positive(),
        strategyRevision: int.min(0),
        mutationCount: int.min(0),
        /** Present only in DEMO: marks seeded demonstration data. Forbidden in REAL. */
        demoSeed: z.object({ seededAt: ms }).strict().nullable(),
        lastChange: lastChangeSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export type BranchRecord = z.infer<typeof branchRecordSchema>;
export type BetRecord = z.infer<typeof betRecordSchema>;
export type BankTransactionRecord = z.infer<typeof bankTransactionRecordSchema>;
export type BranchEventRecord = z.infer<typeof branchEventRecordSchema>;
export type CandidateRecord = z.infer<typeof candidateRecordSchema>;
export type ArchiveEntry = z.infer<typeof archiveEntrySchema>;
export type LastChange = z.infer<typeof lastChangeSchema>;

export const BACKUP_FORMAT = "celltree-backup";
export const BACKUP_KINDS = ["AUTO", "MANUAL", "EXPORT"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/**
 * Backup / export file. Header fields come first in the JSON so backup listings can read a
 * small prefix instead of parsing whole files.
 */
export const backupFileSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    kind: z.enum(BACKUP_KINDS),
    workspace: z.enum(WORKSPACES),
    createdAt: ms,
    reason: z.string(),
    state: workspaceStateSchema,
  })
  .strict();
export type BackupFile = z.infer<typeof backupFileSchema>;
