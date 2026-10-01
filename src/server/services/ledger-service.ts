import { createEmptyState } from "../state/integrity";
import type { StateRepository } from "../state/repository";
import type { WorkspaceState } from "../state/schema";
import { DomainError } from "./errors";

/**
 * Factory Reset REAL: end the current REAL ledger and start a brand-new one.
 *
 * Codes are never reused and external funding is consumed once *within a ledger*. A Factory
 * Reset deliberately terminates that ledger: the new one has no branches, tickets, BANK,
 * events, candidates, archive, change log or reserved codes, and an unconsumed €100 seed, so
 * its first (and only) manual root is A again. Strategy settings are kept as configuration.
 *
 * The complete old ledger is first saved as a RECOVERY backup (never deleted by retention);
 * restoring it brings the old ledger back exactly, including its funding lock and code registry.
 */
export const FACTORY_RESET_CONFIRMATION = "RESET REAL";

export function freshRealLedger(current: WorkspaceState, now: Date): WorkspaceState {
  return createEmptyState("REAL", now, current.settings);
}

export interface FactoryResetResult {
  /** Backup id of the complete previous ledger (null when REAL had never been saved). */
  recoveryBackupId: string | null;
}

export async function factoryResetReal(
  repo: StateRepository,
  confirmation: string,
  now = new Date(),
): Promise<FactoryResetResult> {
  if (confirmation !== FACTORY_RESET_CONFIRMATION) {
    throw new DomainError("VALIDATION", `Type ${FACTORY_RESET_CONFIRMATION} exactly to confirm`);
  }
  const current = await repo.load("REAL");
  const recovery = await repo.backup(
    "REAL",
    "Factory Reset recovery — complete REAL ledger before the reset",
    "RECOVERY",
  );
  await repo.replace(
    "REAL",
    freshRealLedger(current, now),
    recovery
      ? `Factory Reset REAL (previous ledger saved as ${recovery.id})`
      : "Factory Reset REAL",
  );
  return { recoveryBackupId: recovery?.id ?? null };
}
