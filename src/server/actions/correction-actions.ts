"use server";

import {
  applyCorrection,
  deleteCandidate,
  previewCorrection,
  purgeArchiveEntry,
  type ApplyCorrectionInput,
  type CorrectionImpact,
  type CorrectionResult,
  type CorrectionTarget,
  type DeleteMode,
} from "../services/correction-service";
import {
  unarchiveCandidate,
  unarchiveEntry,
  type UnarchiveResult,
} from "../services/unarchive-service";
import type { ActionResult } from "./result";
import { mutateAction, readAction } from "./workspace-op";

/** Impact preview of a correction (nothing is written). */
export async function previewCorrectionAction(
  workspace: string,
  target: CorrectionTarget,
): Promise<ActionResult<CorrectionImpact>> {
  return readAction(workspace, (state, ws) =>
    previewCorrection(state, target, { workspace: ws, now: new Date() }),
  );
}

/** Apply a correction after an automatic snapshot (undoable). */
export async function applyCorrectionAction(
  workspace: string,
  input: ApplyCorrectionInput,
): Promise<ActionResult<CorrectionResult>> {
  return mutateAction(
    workspace,
    (state, ctx) => applyCorrection(state, input, ctx),
    (r) => `${r.label}${r.mode === "PURGE" ? " (permanent)" : ""}`,
  );
}

export async function deleteCandidateAction(
  workspace: string,
  input: { id: string; mode: DeleteMode; confirmation?: string },
): Promise<ActionResult<string>> {
  return mutateAction(
    workspace,
    (state, ctx) => deleteCandidate(state, input, ctx),
    (label) => label,
  );
}

export async function purgeArchiveEntryAction(
  workspace: string,
  input: { archiveId: string; confirmation: string },
): Promise<ActionResult<string>> {
  return mutateAction(
    workspace,
    (state) => `Permanently deleted archived records: ${purgeArchiveEntry(state, input).label}`,
    (label) => label,
  );
}

/** Restore an archived correction (snapshot first, journaled, refused on any conflict). */
export async function unarchiveEntryAction(
  workspace: string,
  input: { archiveId: string },
): Promise<ActionResult<UnarchiveResult>> {
  return mutateAction(
    workspace,
    (state, ctx) => unarchiveEntry(state, input, ctx),
    (r) => `Unarchived: ${r.label}`,
  );
}

export async function unarchiveCandidateAction(
  workspace: string,
  input: { id: string },
): Promise<ActionResult<string>> {
  return mutateAction(
    workspace,
    (state, ctx) => unarchiveCandidate(state, input, ctx),
    (eventName) => `Unarchived candidate ${eventName}`,
  );
}
