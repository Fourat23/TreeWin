import { readdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { verifyLedger } from "@/domain/branches/metrics";
import { centsToDecimalString, formatOdds } from "@/domain/money";
import { strategySettingsSchema } from "@/domain/strategy/settings";
import {
  BANK_DESTINATIONS,
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
} from "@/domain/types";
import { MIGRATIONS_FOLDER, type Db, type DbOrTx } from "../db/client";
import {
  bankTransactions,
  bets,
  branchEvents,
  branches,
  candidates,
  settingsHistory,
  strategySettings,
} from "../db/schema";
import { DomainError } from "./errors";
import { getSettings } from "./settings-service";

/**
 * Full-fidelity JSON backups, strict validated import, and CSV exports.
 * Dates are serialised as epoch milliseconds; amounts stay integer cents.
 */

export const BACKUP_FORMAT = "celltree-backup";
export const BACKUP_VERSION = 1;

const ms = z.number().int().nonnegative();
const nullableMs = ms.nullable();
const int = z.number().int();
const checklist = z.partialRecord(z.enum(CHECKLIST_ITEMS), z.enum(TRISTATE_VALUES)).nullable();

const branchSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1).max(64),
    parentId: z.string().nullable(),
    generation: int.min(0),
    profile: z.enum(PROFILES),
    status: z.enum(BRANCH_STATUSES),
    birthReason: z.enum(BIRTH_REASONS),
    birthBetId: z.string().nullable(),
    birthEventId: int.nullable(),
    birthCapitalCents: int.positive(),
    currentCapitalCents: int.min(0),
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
    childCount: int.min(0),
    createdAt: ms,
    updatedAt: ms,
    maturedAt: nullableMs,
    diedAt: nullableMs,
    lastRoundAt: nullableMs,
    notes: z.string().nullable(),
  })
  .strict();

const betSchema = z
  .object({
    id: z.string().min(1),
    branchId: z.string().min(1),
    sequence: int.positive(),
    roundNumber: int.positive(),
    createdAt: ms,
    updatedAt: ms,
    settledAt: nullableMs,
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    eventTime: z.string().nullable(),
    sport: z.string(),
    competition: z.string(),
    eventName: z.string().min(1),
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
    capitalAfterCents: int.nullable(),
    countsAsRound: z.boolean().nullable(),
    closingOddsBp: int.nullable(),
    notes: z.string().nullable(),
    protocolStatus: z.enum(PROTOCOL_STATUSES).nullable(),
    confidence: int.min(1).max(5).nullable(),
    checklist,
    screenshotPath: z.string().nullable(),
    overrideReason: z.string().nullable(),
    cancelledAt: nullableMs,
    cancelReason: z.string().nullable(),
  })
  .strict();

const bankSchema = z
  .object({
    id: z.string().min(1),
    branchId: z.string().min(1),
    relatedBetId: z.string().nullable(),
    amountCents: int.positive(),
    createdAt: ms,
    type: z.enum(BANK_TX_TYPES),
    harvestKind: z.enum(HARVEST_KINDS).nullable(),
    profile: z.enum(PROFILES),
    destination: z.enum(BANK_DESTINATIONS),
    notes: z.string().nullable(),
  })
  .strict();

const eventSchema = z
  .object({
    id: int.positive(),
    branchId: z.string().min(1),
    type: z.enum(BRANCH_EVENT_TYPES),
    createdAt: ms,
    amountCents: int.nullable(),
    capitalDeltaCents: int,
    capitalAfterCents: int.nullable(),
    statusAfter: z.enum(BRANCH_STATUSES).nullable(),
    relatedBetId: z.string().nullable(),
    relatedBranchId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    description: z.string(),
  })
  .strict();

const candidateSchema = z
  .object({
    id: z.string().min(1),
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
    convertedBetId: z.string().nullable(),
    archivedAt: nullableMs,
  })
  .strict();

export const backupSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: z.string(),
    migration: z.string().nullable(),
    settings: strategySettingsSchema,
    settingsHistory: z.array(
      z.object({ id: int, data: z.unknown(), changedAt: ms, note: z.string().nullable() }).strict(),
    ),
    branches: z.array(branchSchema),
    bets: z.array(betSchema),
    bankTransactions: z.array(bankSchema),
    branchEvents: z.array(eventSchema),
    candidates: z.array(candidateSchema),
  })
  .strict();
export type Backup = z.infer<typeof backupSchema>;

function latestMigrationTag(): string | null {
  try {
    const files = readdirSync(MIGRATIONS_FOLDER)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    return files.at(-1)?.replace(/\.sql$/, "") ?? null;
  } catch {
    return null;
  }
}

type WithDates<T> = {
  [K in keyof T]: T[K] extends Date ? number : T[K] extends Date | null ? number | null : T[K];
};

function serializeDates<T extends Record<string, unknown>>(row: T): WithDates<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row))
    out[key] = value instanceof Date ? value.getTime() : value;
  return out as WithDates<T>;
}

export function exportBackup(db: DbOrTx, now = new Date()): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    migration: latestMigrationTag(),
    settings: getSettings(db),
    settingsHistory: db.select().from(settingsHistory).all().map(serializeDates),
    branches: db.select().from(branches).all().map(serializeDates),
    bets: db
      .select()
      .from(bets)
      .all()
      .map((b) => ({ ...serializeDates(b), checklist: b.checklist ?? null })),
    bankTransactions: db.select().from(bankTransactions).all().map(serializeDates),
    branchEvents: db
      .select()
      .from(branchEvents)
      .all()
      .map((e) => ({ ...serializeDates(e), metadata: e.metadata ?? null })),
    candidates: db
      .select()
      .from(candidates)
      .all()
      .map((c) => ({ ...serializeDates(c), checklist: c.checklist ?? null })),
  };
}

export interface BackupValidation {
  backup: Backup;
  counts: Record<"branches" | "bets" | "bankTransactions" | "branchEvents" | "candidates", number>;
}

/** Strict structural + referential validation. Throws IMPORT_REJECTED with every problem found. */
export function validateBackup(input: unknown): BackupValidation {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("IMPORT_REJECTED", "Backup file does not match the expected format", {
      problems: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  const backup = parsed.data;
  const problems: string[] = [];
  const unique = (label: string, values: (string | number)[]) => {
    if (new Set(values).size !== values.length) problems.push(`Duplicate ${label}`);
  };
  unique(
    "branch ids",
    backup.branches.map((b) => b.id),
  );
  unique(
    "branch codes",
    backup.branches.map((b) => b.code),
  );
  unique(
    "ticket ids",
    backup.bets.map((b) => b.id),
  );
  unique(
    "BANK transaction ids",
    backup.bankTransactions.map((t) => t.id),
  );
  unique(
    "event ids",
    backup.branchEvents.map((e) => e.id),
  );
  unique(
    "candidate ids",
    backup.candidates.map((c) => c.id),
  );

  const branchIds = new Set(backup.branches.map((b) => b.id));
  const betIds = new Set(backup.bets.map((b) => b.id));
  const ref = (ok: boolean, message: string) => {
    if (!ok && problems.length < 50) problems.push(message);
  };
  for (const b of backup.branches) {
    ref(!b.parentId || branchIds.has(b.parentId), `Branch ${b.code}: unknown parent`);
    ref(!b.birthBetId || betIds.has(b.birthBetId), `Branch ${b.code}: unknown birth ticket`);
  }
  for (const b of backup.bets) ref(branchIds.has(b.branchId), `Ticket ${b.id}: unknown branch`);
  for (const t of backup.bankTransactions) {
    ref(branchIds.has(t.branchId), `BANK transaction ${t.id}: unknown branch`);
    ref(!t.relatedBetId || betIds.has(t.relatedBetId), `BANK transaction ${t.id}: unknown ticket`);
  }
  for (const e of backup.branchEvents) {
    ref(branchIds.has(e.branchId), `Event ${e.id}: unknown branch`);
    ref(!e.relatedBetId || betIds.has(e.relatedBetId), `Event ${e.id}: unknown ticket`);
    ref(
      !e.relatedBranchId || branchIds.has(e.relatedBranchId),
      `Event ${e.id}: unknown related branch`,
    );
  }
  for (const c of backup.candidates) {
    ref(!c.convertedBetId || betIds.has(c.convertedBetId), `Candidate ${c.id}: unknown ticket`);
  }
  // Every branch capital must be explained by its own event log.
  const eventsByBranch = new Map<string, Backup["branchEvents"]>();
  for (const e of [...backup.branchEvents].sort((a, b) => a.id - b.id)) {
    const list = eventsByBranch.get(e.branchId) ?? [];
    list.push(e);
    eventsByBranch.set(e.branchId, list);
  }
  for (const b of backup.branches) {
    const check = verifyLedger(eventsByBranch.get(b.id) ?? [], b.currentCapitalCents);
    ref(check.balanced, `Branch ${b.code}: capital is not explained by its events`);
  }
  if (problems.length > 0) {
    throw new DomainError(
      "IMPORT_REJECTED",
      `Backup rejected: ${problems.length} integrity problem(s)`,
      {
        problems,
      },
    );
  }
  return {
    backup,
    counts: {
      branches: backup.branches.length,
      bets: backup.bets.length,
      bankTransactions: backup.bankTransactions.length,
      branchEvents: backup.branchEvents.length,
      candidates: backup.candidates.length,
    },
  };
}

export function isDatabaseEmpty(db: DbOrTx): boolean {
  const n = db
    .select({ n: sql<number>`count(*)` })
    .from(branches)
    .get();
  const c = db
    .select({ n: sql<number>`count(*)` })
    .from(candidates)
    .get();
  return Number(n?.n ?? 0) === 0 && Number(c?.n ?? 0) === 0;
}

function deleteAll(tx: DbOrTx): void {
  tx.run(sql`PRAGMA defer_foreign_keys = ON`);
  tx.delete(candidates).run();
  tx.delete(branchEvents).run();
  tx.delete(bankTransactions).run();
  tx.update(branches).set({ birthBetId: null }).run();
  tx.delete(bets).run();
  tx.delete(branches).run();
}

function chunks<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const toDate = (v: number) => new Date(v);
const toNullableDate = (v: number | null) => (v === null ? null : new Date(v));

/**
 * Replace every ledger row with the backup content, atomically. Callers must make sure the
 * user explicitly confirmed the replacement (and should keep a pre-import backup).
 */
export function importBackup(db: Db, input: unknown): BackupValidation["counts"] {
  const { backup, counts } = validateBackup(input);
  db.transaction((tx) => {
    deleteAll(tx);
    tx.delete(settingsHistory).run();
    for (const part of chunks(backup.branches)) {
      tx.insert(branches)
        .values(
          part.map((b) => ({
            ...b,
            createdAt: toDate(b.createdAt),
            updatedAt: toDate(b.updatedAt),
            maturedAt: toNullableDate(b.maturedAt),
            diedAt: toNullableDate(b.diedAt),
            lastRoundAt: toNullableDate(b.lastRoundAt),
          })),
        )
        .run();
    }
    for (const part of chunks(backup.bets)) {
      tx.insert(bets)
        .values(
          part.map((b) => ({
            ...b,
            checklist: b.checklist ?? undefined,
            createdAt: toDate(b.createdAt),
            updatedAt: toDate(b.updatedAt),
            settledAt: toNullableDate(b.settledAt),
            cancelledAt: toNullableDate(b.cancelledAt),
          })),
        )
        .run();
    }
    for (const part of chunks(backup.bankTransactions)) {
      tx.insert(bankTransactions)
        .values(part.map((t) => ({ ...t, createdAt: toDate(t.createdAt) })))
        .run();
    }
    for (const part of chunks(backup.branchEvents)) {
      tx.insert(branchEvents)
        .values(
          part.map((e) => ({
            ...e,
            metadata: e.metadata ?? undefined,
            createdAt: toDate(e.createdAt),
          })),
        )
        .run();
    }
    for (const part of chunks(backup.candidates)) {
      tx.insert(candidates)
        .values(
          part.map((c) => ({
            ...c,
            checklist: c.checklist ?? undefined,
            createdAt: toDate(c.createdAt),
            updatedAt: toDate(c.updatedAt),
            archivedAt: toNullableDate(c.archivedAt),
          })),
        )
        .run();
    }
    for (const part of chunks(backup.settingsHistory)) {
      tx.insert(settingsHistory)
        .values(part.map((h) => ({ ...h, data: h.data ?? {}, changedAt: toDate(h.changedAt) })))
        .run();
    }
    const now = new Date();
    tx.insert(strategySettings)
      .values({ id: 1, data: backup.settings, updatedAt: now })
      .onConflictDoUpdate({
        target: strategySettings.id,
        set: { data: backup.settings, updatedAt: now },
      })
      .run();
  });
  return counts;
}

/** Development helper: remove every branch, ticket, BANK row, event and candidate. */
export function wipeLedger(db: Db): void {
  db.transaction((tx) => deleteAll(tx));
}

/* ---------------------------------- CSV ---------------------------------- */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a UTF-8 BOM (Excel-friendly). Amounts use a dot decimal separator. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const iso = (d: Date | null) => (d ? d.toISOString() : "");
const money = (c: number | null) => (c === null ? "" : centsToDecimalString(c));
const odds = (bp: number | null) => (bp === null ? "" : formatOdds(bp));

export function ticketsCsv(db: DbOrTx): string {
  const codes = new Map(
    db
      .select({ id: branches.id, code: branches.code, profile: branches.profile })
      .from(branches)
      .all()
      .map((b) => [b.id, b]),
  );
  const rows = db.select().from(bets).all();
  return toCsv(
    [
      "id",
      "branch",
      "profile",
      "round",
      "sequence",
      "created_at",
      "event_date",
      "event_time",
      "sport",
      "competition",
      "event",
      "market",
      "selection",
      "bookmaker",
      "odds",
      "stake",
      "potential_return",
      "result",
      "actual_return",
      "profit_loss",
      "capital_before",
      "capital_after",
      "closing_odds",
      "protocol_status",
      "confidence",
      "cancelled_at",
      "notes",
    ],
    rows.map((b) => [
      b.id,
      codes.get(b.branchId)?.code,
      codes.get(b.branchId)?.profile,
      b.roundNumber,
      b.sequence,
      iso(b.createdAt),
      b.eventDate,
      b.eventTime,
      b.sport,
      b.competition,
      b.eventName,
      b.marketName,
      b.selection,
      b.bookmaker,
      odds(b.oddsBp),
      money(b.stakeCents),
      money(b.potentialReturnCents),
      b.result,
      money(b.actualReturnCents),
      money(b.profitLossCents),
      money(b.capitalBeforeCents),
      money(b.capitalAfterCents),
      odds(b.closingOddsBp),
      b.protocolStatus,
      b.confidence,
      iso(b.cancelledAt),
      b.notes,
    ]),
  );
}

export function branchesCsv(db: DbOrTx): string {
  const rows = db.select().from(branches).all();
  const codes = new Map(rows.map((b) => [b.id, b.code]));
  return toCsv(
    [
      "id",
      "code",
      "parent",
      "generation",
      "profile",
      "status",
      "birth_reason",
      "birth_capital",
      "current_capital",
      "cap",
      "peak_capital",
      "bank_generated",
      "child_capital_generated",
      "lost",
      "wins",
      "losses",
      "voids",
      "rounds",
      "children",
      "created_at",
      "matured_at",
      "died_at",
    ],
    rows.map((b) => [
      b.id,
      b.code,
      b.parentId ? codes.get(b.parentId) : "",
      b.generation,
      b.profile,
      b.status,
      b.birthReason,
      money(b.birthCapitalCents),
      money(b.currentCapitalCents),
      money(b.capCents),
      money(b.peakCapitalCents),
      money(b.totalBankGeneratedCents),
      money(b.totalChildCapitalGeneratedCents),
      money(b.totalLostCents),
      b.wins,
      b.losses,
      b.voids,
      b.roundCount,
      b.childCount,
      iso(b.createdAt),
      iso(b.maturedAt),
      iso(b.diedAt),
    ]),
  );
}

export function bankCsv(db: DbOrTx): string {
  const codes = new Map(
    db
      .select({ id: branches.id, code: branches.code })
      .from(branches)
      .all()
      .map((b) => [b.id, b.code]),
  );
  const rows = db.select().from(bankTransactions).all();
  return toCsv(
    [
      "id",
      "created_at",
      "branch",
      "profile",
      "amount",
      "type",
      "harvest_kind",
      "destination",
      "related_ticket",
      "notes",
    ],
    rows.map((t) => [
      t.id,
      iso(t.createdAt),
      codes.get(t.branchId),
      t.profile,
      money(t.amountCents),
      t.type,
      t.harvestKind,
      t.destination,
      t.relatedBetId,
      t.notes,
    ]),
  );
}
