import { z } from "zod";
import { centsToDecimalString, formatOdds } from "@/domain/money";
import {
  DEFAULT_SETTINGS,
  strategySettingsSchema,
  type StrategySettings,
} from "@/domain/strategy/settings";
import type { Workspace } from "@/domain/types";
import { findIntegrityProblems } from "../state/integrity";
import {
  BACKUP_FORMAT,
  STATE_FORMAT,
  STATE_SCHEMA_VERSION,
  backupFileSchema,
  workspaceStateSchema,
  type BackupFile,
  type BranchEventRecord,
  type WorkspaceState,
} from "../state/schema";
import { DomainError } from "./errors";

/**
 * Export / import of whole workspaces, and CSV exports.
 *
 * Files carry their workspace identity. Rules:
 *   - a DEMO file can NEVER be imported into REAL
 *   - a REAL file can be imported into DEMO only as an explicit copy
 *   - a V1.0 export (SQLite era, no workspace identity) is migrated on the fly; one that
 *     contains the demo dataset counts as DEMO
 * The import itself replaces the target workspace after an automatic snapshot.
 */

export function exportWorkspace(state: WorkspaceState, now = new Date()): BackupFile {
  return {
    format: BACKUP_FORMAT,
    kind: "EXPORT",
    workspace: state.workspace,
    createdAt: now.getTime(),
    reason: `Export of the ${state.workspace} workspace`,
    state,
  };
}

export interface ImportPreview {
  /** Workspace the file belongs to (LEGACY = V1.0 export without identity). */
  source: Workspace | "LEGACY";
  target: Workspace;
  asCopy: boolean;
  savedAt: string | null;
  counts: {
    branches: number;
    tickets: number;
    bankTransactions: number;
    events: number;
    candidates: number;
  };
  warnings: string[];
}

export interface PreparedImport {
  state: WorkspaceState;
  preview: ImportPreview;
}

function rejected(message: string, problems: string[] = []): DomainError {
  return new DomainError("IMPORT_REJECTED", message, { problems });
}

/**
 * Parse and validate an import for `target`. Never touches disk: the caller persists the
 * returned state through the repository (which snapshots the current one first).
 */
export function prepareImport(
  raw: unknown,
  target: Workspace,
  options: { asCopy?: boolean } = {},
  now = new Date(),
): PreparedImport {
  if (!raw || typeof raw !== "object") throw rejected("The file is not a CELLTREE export");
  const obj = raw as Record<string, unknown>;
  const warnings: string[] = [];
  let state: WorkspaceState;
  let source: ImportPreview["source"];

  if (obj.format === BACKUP_FORMAT && "state" in obj) {
    const parsed = backupFileSchema.safeParse(raw);
    if (!parsed.success)
      throw rejected("Backup file does not match the expected format", issues(parsed.error));
    if (parsed.data.workspace !== parsed.data.state.workspace)
      throw rejected("Inconsistent workspace identity in the file");
    state = parsed.data.state;
    source = state.workspace;
  } else if (obj.format === STATE_FORMAT) {
    const parsed = workspaceStateSchema.safeParse(raw);
    if (!parsed.success)
      throw rejected("State file does not match the expected format", issues(parsed.error));
    state = parsed.data;
    source = state.workspace;
  } else if (obj.format === BACKUP_FORMAT && obj.version === 1 && Array.isArray(obj.branches)) {
    const migrated = migrateLegacyBackup(obj, now);
    state = migrated.state;
    source = migrated.looksLikeDemo ? "DEMO" : "LEGACY";
    warnings.push(...migrated.warnings);
  } else {
    throw rejected("Unknown file format (expected a CELLTREE export)");
  }

  if (target === "REAL" && (source === "DEMO" || state.metadata.demoSeed !== null)) {
    throw rejected("A DEMO file can never be imported into the REAL workspace");
  }
  const asCopy = target === "DEMO" && source === "REAL";
  if (asCopy && !options.asCopy) {
    throw rejected(
      "This file holds REAL data. Tick “import as a copy” to load it into DEMO for experiments.",
    );
  }
  if (source === "LEGACY") {
    warnings.push(
      "V1.0 file without workspace identity: make sure it contains only your genuine tickets.",
    );
  }

  const next: WorkspaceState = structuredClone(state);
  next.workspace = target;
  next.metadata.lastChange = null; // snapshot ids of the source workspace mean nothing here
  const problems = findIntegrityProblems(next, target);
  if (problems.length > 0)
    throw rejected(`Import rejected: ${problems.length} integrity problem(s)`, problems);

  return {
    state: next,
    preview: {
      source,
      target,
      asCopy,
      savedAt: source === "LEGACY" ? null : state.savedAt,
      counts: {
        branches: next.branches.length,
        tickets: next.bets.length,
        bankTransactions: next.bankTransactions.length,
        events: next.branchEvents.length,
        candidates: next.candidates.length,
      },
      warnings,
    },
  };
}

function issues(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`);
}

/* ------------------------------ V1.0 migration ----------------------------- */

const legacyRecords = z
  .object({
    settings: z.unknown(),
    branches: z.array(z.record(z.string(), z.unknown())),
    bets: z.array(z.record(z.string(), z.unknown())),
    bankTransactions: z.array(z.record(z.string(), z.unknown())),
    branchEvents: z.array(z.record(z.string(), z.unknown())),
    candidates: z.array(z.record(z.string(), z.unknown())),
  })
  .loose();

/**
 * Convert a V1.0 (SQLite) JSON export into a V1.1 state. Records keep their ids and history;
 * new fields get their baseline values (strategy 1.0, BANK entries SECURED). Strategy settings
 * are reset to the V1.1 defaults; only display preferences are carried over.
 */
export function migrateLegacyBackup(
  raw: Record<string, unknown>,
  now = new Date(),
): { state: WorkspaceState; warnings: string[]; looksLikeDemo: boolean } {
  const parsed = legacyRecords.safeParse(raw);
  if (!parsed.success) throw rejected("V1.0 export is incomplete", issues(parsed.error));
  const legacy = parsed.data;
  const warnings = [
    "V1.0 export migrated: strategy settings reset to the V1.1 defaults (review Settings).",
  ];

  const previous = (legacy.settings ?? {}) as Partial<StrategySettings>;
  const settings: StrategySettings = strategySettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...(typeof previous.currency === "string" ? { currency: previous.currency } : {}),
    ...(typeof previous.locale === "string" ? { locale: previous.locale } : {}),
    ...(typeof previous.roundLabel === "string" ? { roundLabel: previous.roundLabel } : {}),
    ...(typeof previous.roundShortLabel === "string"
      ? { roundShortLabel: previous.roundShortLabel }
      : {}),
  });

  const stamp = { strategyVersion: settings.strategyVersion, strategyRevision: 0 };
  const events = legacy.branchEvents.map((e) => ({ ...e })) as unknown as BranchEventRecord[];
  const branches = legacy.branches.map((b) => ({
    ...b,
    ...stamp,
  })) as unknown as WorkspaceState["branches"];

  // V1.0 BIRTH events did not record the initial P1 state / cap: reconstruct them.
  for (const branch of branches) {
    const own = events.filter((e) => e.branchId === branch.id).sort((a, b) => a.id - b.id);
    const birth = own.find((e) => e.type === "BIRTH");
    if (!birth) continue;
    const hadP1Harvest = own.some((e) => e.type === "HARVEST" && e.metadata?.kind === "P1");
    const firstProfileChange = own.find((e) => e.type === "PROFILE_CHANGED");
    const initialCap =
      typeof firstProfileChange?.metadata?.previousCapCents === "number"
        ? firstProfileChange.metadata.previousCapCents
        : branch.capCents;
    const initialProfile =
      typeof firstProfileChange?.metadata?.from === "string"
        ? firstProfileChange.metadata.from
        : branch.profile;
    birth.metadata = {
      ...birth.metadata,
      profile: birth.metadata?.profile ?? initialProfile,
      capCents: typeof birth.metadata?.capCents === "number" ? birth.metadata.capCents : initialCap,
      p1Done: branch.p1Done && !hadP1Harvest,
    };
  }

  const looksLikeDemo = branches.some((b) => b.parentId === null && b.notes === "Demo root");
  const state: WorkspaceState = {
    format: STATE_FORMAT,
    schemaVersion: STATE_SCHEMA_VERSION,
    workspace: looksLikeDemo ? "DEMO" : "REAL",
    strategyVersion: settings.strategyVersion,
    savedAt: now.toISOString(),
    settings,
    settingsHistory: [],
    branches,
    bets: legacy.bets.map((b) => ({
      ...b,
      outsideV1: false,
      ...stamp,
    })) as unknown as WorkspaceState["bets"],
    bankTransactions: legacy.bankTransactions.map((t) => ({
      ...t,
      status: "SECURED",
      withdrawnAt: null,
    })) as unknown as WorkspaceState["bankTransactions"],
    branchEvents: events,
    candidates: legacy.candidates as unknown as WorkspaceState["candidates"],
    archive: [],
    auditLog: [],
    metadata: {
      createdAt: now.getTime(),
      nextEventId: Math.max(0, ...events.map((e) => Number(e.id) || 0)) + 1,
      strategyRevision: 0,
      mutationCount: 0,
      demoSeed: looksLikeDemo ? { seededAt: now.getTime() } : null,
      lastChange: null,
      reservedCodes: [],
    },
  };
  const valid = workspaceStateSchema.safeParse(state);
  if (!valid.success) throw rejected("V1.0 export could not be migrated", issues(valid.error));
  return { state: valid.data, warnings, looksLikeDemo };
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

const iso = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString());
const money = (c: number | null) => (c === null ? "" : centsToDecimalString(c));
const odds = (bp: number | null) => (bp === null ? "" : formatOdds(bp));

export function ticketsCsv(state: WorkspaceState): string {
  const branches = new Map(state.branches.map((b) => [b.id, b]));
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
      "strategy_version",
      "override_reason",
      "notes",
    ],
    state.bets.map((b) => [
      b.id,
      branches.get(b.branchId)?.code,
      branches.get(b.branchId)?.profile,
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
      `${b.strategyVersion}r${b.strategyRevision}`,
      b.overrideReason,
      b.notes,
    ]),
  );
}

export function branchesCsv(state: WorkspaceState): string {
  const codes = new Map(state.branches.map((b) => [b.id, b.code]));
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
      "strategy_version",
    ],
    state.branches.map((b) => [
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
      `${b.strategyVersion}r${b.strategyRevision}`,
    ]),
  );
}

export function bankCsv(state: WorkspaceState): string {
  const codes = new Map(state.branches.map((b) => [b.id, b.code]));
  return toCsv(
    [
      "id",
      "created_at",
      "branch",
      "profile",
      "amount",
      "type",
      "harvest_kind",
      "status",
      "withdrawn_at",
      "destination",
      "related_ticket",
      "notes",
    ],
    state.bankTransactions.map((t) => [
      t.id,
      iso(t.createdAt),
      codes.get(t.branchId),
      t.profile,
      money(t.amountCents),
      t.type,
      t.harvestKind,
      t.status,
      iso(t.withdrawnAt),
      t.destination,
      t.relatedBetId,
      t.notes,
    ]),
  );
}
