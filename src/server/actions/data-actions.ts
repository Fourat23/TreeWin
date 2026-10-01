"use server";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import type { BankDestination } from "@/domain/types";
import { getDb, getDbPath } from "../db";
import { bankTransactions } from "../db/schema";
import {
  exportBackup,
  importBackup,
  isDatabaseEmpty,
  validateBackup,
  wipeLedger,
} from "../services/backup-service";
import { seedDemoData } from "../services/demo-seed";
import { DomainError } from "../services/errors";
import { saveSettings } from "../services/settings-service";
import { DEFAULT_SETTINGS } from "@/domain/strategy/settings";
import { runAction, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/", "layout");
}

const isDev = () => process.env.NODE_ENV !== "production";

function writePreImportBackup(): string {
  const dir = join(dirname(getDbPath()), "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `pre-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(exportBackup(getDb()), null, 2));
  return file;
}

export async function saveSettingsAction(input: unknown): Promise<ActionResult> {
  const result = runAction(() => void saveSettings(getDb(), input, { note: "Edited in Settings" }));
  if (result.ok) refresh();
  return result;
}

export async function resetSettingsAction(): Promise<ActionResult> {
  const result = runAction(
    () => void saveSettings(getDb(), DEFAULT_SETTINGS, { note: "Reset to defaults" }),
  );
  if (result.ok) refresh();
  return result;
}

export async function setBankDestinationAction(input: {
  transactionId: string;
  destination: BankDestination;
}): Promise<ActionResult> {
  const result = runAction(() => {
    const db = getDb();
    const row = db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.id, input.transactionId))
      .get();
    if (!row) throw new DomainError("NOT_FOUND", "BANK transaction not found");
    db.update(bankTransactions)
      .set({ destination: input.destination })
      .where(eq(bankTransactions.id, input.transactionId))
      .run();
  });
  if (result.ok) refresh();
  return result;
}

export async function previewBackupAction(
  content: string,
): Promise<
  ActionResult<{ counts: Record<string, number>; exportedAt: string; databaseEmpty: boolean }>
> {
  return runAction(() => {
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new DomainError("IMPORT_REJECTED", "The file is not valid JSON");
    }
    const { backup, counts } = validateBackup(json);
    return { counts, exportedAt: backup.exportedAt, databaseEmpty: isDatabaseEmpty(getDb()) };
  });
}

/**
 * Import never overwrites silently: a non-empty database requires the typed confirmation
 * "REPLACE", and a full pre-import backup is written next to the database first.
 */
export async function importBackupAction(input: {
  content: string;
  confirmation: string;
}): Promise<ActionResult<{ counts: Record<string, number>; safetyBackup: string | null }>> {
  const result = runAction(() => {
    const db = getDb();
    let json: unknown;
    try {
      json = JSON.parse(input.content);
    } catch {
      throw new DomainError("IMPORT_REJECTED", "The file is not valid JSON");
    }
    validateBackup(json);
    let safetyBackup: string | null = null;
    if (!isDatabaseEmpty(db)) {
      if (input.confirmation !== "REPLACE") {
        throw new DomainError("VALIDATION", "Type REPLACE to confirm replacing the current data");
      }
      safetyBackup = writePreImportBackup();
    }
    return { counts: importBackup(db, json), safetyBackup };
  });
  if (result.ok) refresh();
  return result;
}

/** Load the demo dataset — only into an empty database. */
export async function loadDemoDataAction(): Promise<ActionResult> {
  const result = runAction(() => void seedDemoData(getDb()));
  if (result.ok) refresh();
  return result;
}

/** Development only: wipe the ledger and reload the demo dataset. */
export async function resetDemoDataAction(): Promise<ActionResult> {
  const result = runAction(() => {
    if (!isDev()) throw new DomainError("INVALID_STATE", "Reset is only available in development");
    const db = getDb();
    writePreImportBackup();
    wipeLedger(db);
    seedDemoData(db);
  });
  if (result.ok) refresh();
  return result;
}

/** Development only: wipe the ledger to start from scratch (a safety backup is written first). */
export async function wipeDataAction(): Promise<ActionResult> {
  const result = runAction(() => {
    if (!isDev()) throw new DomainError("INVALID_STATE", "Wipe is only available in development");
    writePreImportBackup();
    wipeLedger(getDb());
  });
  if (result.ok) refresh();
  return result;
}
