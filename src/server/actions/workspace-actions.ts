"use server";

import { cookies } from "next/headers";
import { DEFAULT_SETTINGS } from "@/domain/strategy/settings";
import type { Workspace } from "@/domain/types";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import { prepareImport, type ImportPreview } from "../services/backup-service";
import { buildDemoState } from "../services/demo-seed";
import { DomainError } from "../services/errors";
import { saveSettings } from "../services/settings-service";
import { getRepository } from "../state";
import { createEmptyState } from "../state/integrity";
import type { BackupInfo } from "../state/repository";
import type { WorkspaceState } from "../state/schema";
import { runAction, type ActionResult } from "./result";
import { mutateAction, refreshAll, requireWorkspace } from "./workspace-op";

/* --------------------------------- switch --------------------------------- */

/** Remember which workspace the UI shows. Only a preference: no data is read or written. */
export async function setWorkspacePreferenceAction(
  workspace: string,
): Promise<ActionResult<Workspace>> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    (await cookies()).set(WORKSPACE_COOKIE, ws, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
    });
    refreshAll();
    return ws;
  });
}

/* -------------------------------- settings -------------------------------- */

export async function saveSettingsAction(
  workspace: string,
  input: unknown,
): Promise<ActionResult<{ strategyChanged: boolean }>> {
  return mutateAction(
    workspace,
    (state, ctx) => ({
      strategyChanged: saveSettings(state, input, ctx, "Edited in Settings").strategyChanged,
    }),
    "Saved strategy settings",
  );
}

export async function resetSettingsAction(
  workspace: string,
): Promise<ActionResult<{ strategyChanged: boolean }>> {
  return mutateAction(
    workspace,
    (state, ctx) => ({
      strategyChanged: saveSettings(state, DEFAULT_SETTINGS, ctx, "Reset to defaults")
        .strategyChanged,
    }),
    "Reset strategy settings to the V1 defaults",
  );
}

/* ----------------------------- backups & undo ----------------------------- */

export async function listBackupsAction(workspace: string): Promise<ActionResult<BackupInfo[]>> {
  return runAction(() => getRepository().listBackups(requireWorkspace(workspace)));
}

/** Manual backup: never deleted by the automatic retention. */
export async function createBackupAction(
  workspace: string,
  note?: string,
): Promise<ActionResult<BackupInfo>> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    const info = await getRepository().backup(ws, note?.trim() || "Manual backup", "MANUAL");
    if (!info)
      throw new DomainError(
        "INVALID_STATE",
        "Nothing to back up yet: this workspace has never been saved",
      );
    return info;
  });
}

/** Restore a snapshot. The current state is snapshotted first, so a restore can be undone too. */
export async function restoreBackupAction(
  workspace: string,
  backupId: string,
): Promise<ActionResult> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    await getRepository().restore(ws, backupId, `Restored snapshot ${backupId}`);
    refreshAll();
  });
}

/** Restore the most recent snapshot (the state just before the last recorded change). */
export async function restorePreviousSnapshotAction(
  workspace: string,
): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    const latest = (await getRepository().listBackups(ws))[0];
    if (!latest) throw new DomainError("NOT_FOUND", "No snapshot available yet");
    await getRepository().restore(ws, latest.id, `Restored previous snapshot ${latest.id}`);
    refreshAll();
    return latest.id;
  });
}

/** Undo the last recorded change (restores the snapshot taken right before it). */
export async function undoLastChangeAction(workspace: string): Promise<ActionResult<string>> {
  return runAction(async () => {
    const undone = await getRepository().undo(requireWorkspace(workspace));
    if (undone === null) throw new DomainError("INVALID_STATE", "Nothing to undo");
    refreshAll();
    return undone;
  });
}

/* ------------------------------ import/export ----------------------------- */

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new DomainError("IMPORT_REJECTED", "The file is not valid JSON");
  }
}

function hasData(state: WorkspaceState): boolean {
  return state.branches.length > 0 || state.candidates.length > 0 || state.bets.length > 0;
}

export async function previewImportAction(
  workspace: string,
  input: { content: string; asCopy?: boolean },
): Promise<ActionResult<ImportPreview & { targetHasData: boolean }>> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    const { preview } = prepareImport(parseJson(input.content), ws, { asCopy: input.asCopy });
    return { ...preview, targetHasData: hasData(await getRepository().load(ws)) };
  });
}

/**
 * Replace a workspace with an imported file. A non-empty target requires the typed
 * confirmation "REPLACE"; an automatic snapshot is always taken first (undoable).
 */
export async function importWorkspaceAction(
  workspace: string,
  input: { content: string; asCopy?: boolean; confirmation?: string },
): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    const ws = requireWorkspace(workspace);
    const repo = getRepository();
    const { state, preview } = prepareImport(parseJson(input.content), ws, {
      asCopy: input.asCopy,
    });
    const current = await repo.load(ws);
    if (hasData(current) && input.confirmation !== "REPLACE") {
      throw new DomainError(
        "VALIDATION",
        `Type REPLACE to confirm replacing the current ${ws} data`,
      );
    }
    // Codes used before the import stay reserved (never reassigned to another branch).
    state.metadata.reservedCodes = [
      ...new Set([...current.metadata.reservedCodes, ...state.metadata.reservedCodes]),
    ];
    await repo.replace(
      ws,
      state,
      `Imported ${preview.source === "LEGACY" ? "a V1.0" : `a ${preview.source}`} file into ${ws}`,
    );
    refreshAll();
    return preview;
  });
}

/* ------------------------------ demo & reset ------------------------------ */

function requireDemo(workspace: string): "DEMO" {
  if (requireWorkspace(workspace) !== "DEMO") {
    throw new DomainError(
      "WORKSPACE_MISMATCH",
      "Demo data can only ever be written to the DEMO workspace",
    );
  }
  return "DEMO";
}

/** Seed the DEMO workspace (only while it is empty). */
export async function initializeDemoAction(
  workspace: string,
): Promise<ActionResult<{ branches: number; tickets: number }>> {
  return runAction(async () => {
    const ws = requireDemo(workspace);
    const repo = getRepository();
    const current = await repo.load(ws);
    if (hasData(current))
      throw new DomainError("INVALID_STATE", "DEMO already contains data — use Reset DEMO");
    const { state, summary } = buildDemoState(new Date(), current.settings);
    await repo.replace(ws, state, "Initialized DEMO data");
    refreshAll();
    return summary;
  });
}

/** Recreate data/demo/state.json from scratch. REAL is never touched. */
export async function resetDemoAction(
  workspace: string,
): Promise<ActionResult<{ branches: number; tickets: number }>> {
  return runAction(async () => {
    const ws = requireDemo(workspace);
    const { state, summary } = buildDemoState(new Date(), DEFAULT_SETTINGS);
    await getRepository().replace(ws, state, "Reset DEMO data");
    refreshAll();
    return summary;
  });
}

/** Wipe every REAL record (settings kept). Requires typing RESET REAL; snapshot taken first. */
export async function resetRealAction(
  workspace: string,
  confirmation: string,
): Promise<ActionResult> {
  return runAction(async () => {
    if (requireWorkspace(workspace) !== "REAL")
      throw new DomainError("WORKSPACE_MISMATCH", "Not the REAL workspace");
    if (confirmation.trim() !== "RESET REAL")
      throw new DomainError("VALIDATION", "Type RESET REAL to confirm");
    const repo = getRepository();
    const current = await repo.load("REAL");
    const empty = createEmptyState("REAL", new Date(), current.settings);
    empty.settingsHistory = structuredClone(current.settingsHistory);
    empty.metadata.strategyRevision = current.metadata.strategyRevision;
    empty.metadata.mutationCount = current.metadata.mutationCount;
    // Branch codes stay reserved forever, even across a reset.
    empty.metadata.reservedCodes = [...current.metadata.reservedCodes];
    await repo.replace("REAL", empty, "Reset REAL workspace (all records deleted)");
    refreshAll();
  });
}
