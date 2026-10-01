import { z } from "zod";
import { findIntegrityProblems } from "../state/integrity";
import type { ArchiveEntry, BranchEventRecord, WorkspaceState } from "../state/schema";
import { getCandidateOrThrow } from "./candidate-service";
import { rebuildBranch } from "./correction-service";
import { DomainError, notFound } from "./errors";
import { isOpenTicket, moneyFormatter, parseInput, pushEvent, type OpContext } from "./internal";

/**
 * Unarchive: put records removed by an archive-mode correction (or an archived candidate) back
 * into the ledger, exactly as they were — nothing else of the history is restored.
 *
 * It is only allowed when it is structurally safe. For a "delete / reopen from this point"
 * correction, the corrected branch must not have changed since (otherwise the archived history
 * no longer fits after it). Ids and codes must still be free (codes are reserved forever, so
 * they always are), and in REAL no restored pending ticket may break "one branch per match".
 * Any conflict is reported with a clear error and nothing is changed.
 *
 * DEAD and ARCHIVED are separate concepts: a branch that was dead when archived comes back dead.
 */

export const unarchiveSchema = z.object({ archiveId: z.string().min(1) });

export interface UnarchiveResult {
  label: string;
  branches: number;
  tickets: number;
  bankCents: number;
}

function correctionMarker(
  state: WorkspaceState,
  entry: ArchiveEntry,
): BranchEventRecord | undefined {
  return state.branchEvents.find(
    (e) =>
      e.type === "MANUAL_ADJUSTMENT" &&
      e.metadata?.kind === "CORRECTION" &&
      e.metadata.archiveId === entry.id,
  );
}

/** Every reason why restoring `entry` would not be safe (empty = safe). */
export function unarchiveConflicts(
  state: WorkspaceState,
  entry: ArchiveEntry,
  workspace: OpContext["workspace"],
): string[] {
  const conflicts: string[] = [];
  const liveBranches = new Map(state.branches.map((b) => [b.id, b]));
  const liveBets = new Map(state.bets.map((b) => [b.id, b]));
  const liveCodes = new Set(state.branches.map((b) => b.code));
  const liveEventIds = new Set(state.branchEvents.map((e) => e.id));
  const liveBankIds = new Set(state.bankTransactions.map((t) => t.id));
  const entryBranchIds = new Set(entry.branches.map((b) => b.id));
  const marker = correctionMarker(state, entry);

  for (const b of entry.branches) {
    if (liveBranches.has(b.id) || liveCodes.has(b.code)) {
      conflicts.push(`Branch ${b.code} is already in the ledger`);
    }
    if (b.parentId && !entryBranchIds.has(b.parentId) && !liveBranches.has(b.parentId)) {
      conflicts.push(`The parent of ${b.code} no longer exists`);
    }
  }
  for (const e of entry.branchEvents) {
    if (liveEventIds.has(e.id)) conflicts.push(`Event #${e.id} already exists`);
  }
  for (const t of entry.bankTransactions) {
    if (liveBankIds.has(t.id)) conflicts.push(`BANK entry ${t.id} already exists`);
  }

  if (marker) {
    const branch = liveBranches.get(marker.branchId);
    if (!branch) {
      conflicts.push("The corrected branch no longer exists");
    } else {
      const later = state.branchEvents.filter((e) => e.branchId === branch.id && e.id > marker.id);
      if (later.length > 0) {
        conflicts.push(
          `${branch.code} has new history since this correction (${later.length} event(s)); use Undo or restore a snapshot instead`,
        );
      }
      for (const bet of entry.bets) {
        const live = liveBets.get(bet.id);
        if (!live) continue; // removed ticket: restored as a new record
        if (live.branchId !== branch.id || !isOpenTicket(live)) {
          conflicts.push(
            `Ticket ${branch.code}·R${live.roundNumber} has changed since this correction`,
          );
        }
      }
    }
  } else {
    // Without a correction marker only a whole root subtree can be restored on its own.
    const roots = entry.branches.filter((b) => b.parentId === null);
    if (roots.length !== 1 || entry.bets.some((b) => liveBets.has(b.id))) {
      conflicts.push(
        "This archive entry cannot be restored automatically; restore a snapshot instead",
      );
    }
  }

  if (workspace === "REAL" && state.settings.sameEventPolicy === "BLOCK") {
    const restoredOpen = entry.bets.filter((b) => isOpenTicket(b) && !liveBets.has(b.id));
    const livePending = state.bets.filter(
      (b) => isOpenTicket(b) && !entryBranchIds.has(b.branchId),
    );
    for (const bet of restoredOpen) {
      const clash = livePending.find((p) => p.eventKey === bet.eventKey);
      if (clash) {
        const code = liveBranches.get(clash.branchId)?.code ?? "?";
        conflicts.push(`${bet.eventName} is already pending on ${code} (one branch per match)`);
      }
    }
  }
  return [...new Set(conflicts)];
}

/** Restore an archived correction. Throws (and changes nothing) on any structural conflict. */
export function unarchiveEntry(
  state: WorkspaceState,
  input: z.input<typeof unarchiveSchema>,
  ctx: OpContext,
): UnarchiveResult {
  const { archiveId } = parseInput(unarchiveSchema, input);
  const entry = state.archive.find((a) => a.id === archiveId);
  if (!entry) throw notFound("Archive entry", archiveId);
  const conflicts = unarchiveConflicts(state, entry, ctx.workspace);
  if (conflicts.length > 0) {
    throw new DomainError("INVALID_STATE", `Cannot unarchive safely: ${conflicts[0]}`, {
      conflicts,
    });
  }

  const now = ctx.now.getTime();
  const restored = structuredClone(entry);
  const marker = correctionMarker(state, entry);

  state.branches.push(...restored.branches);
  for (const bet of restored.bets) {
    const index = state.bets.findIndex((b) => b.id === bet.id);
    // A ticket reopened by the correction gets its archived (settled) version back.
    if (index >= 0) state.bets[index] = bet;
    else state.bets.push(bet);
  }
  state.bankTransactions.push(...restored.bankTransactions);
  state.branchEvents.push(...restored.branchEvents);
  state.branchEvents.sort((a, b) => a.id - b.id);
  for (const copy of restored.candidates) {
    const live = state.candidates.find((c) => c.id === copy.id);
    if (live && live.convertedBetId === null && copy.convertedBetId) {
      live.convertedBetId = copy.convertedBetId;
      live.updatedAt = now;
    }
  }
  state.archive = state.archive.filter((a) => a.id !== entry.id);

  // The correction marker stays in the journal as an audit line, but no longer carries a
  // capital/status snapshot (the history it summarised is back in front of it).
  const anchorId =
    marker?.branchId ?? restored.branches.find((b) => b.parentId === null)?.id ?? null;
  if (marker) {
    marker.capitalAfterCents = null;
    marker.statusAfter = null;
    marker.metadata = { ...marker.metadata, unarchivedAt: now };
    const branch = state.branches.find((b) => b.id === marker.branchId);
    if (branch) rebuildBranch(state, branch, now);
  }

  const fmt = moneyFormatter(state.settings);
  const bankCents = restored.bankTransactions.reduce((s, t) => s + t.amountCents, 0);
  const anchor = state.branches.find((b) => b.id === anchorId);
  if (anchor) {
    pushEvent(state, {
      branchId: anchor.id,
      type: "MANUAL_ADJUSTMENT",
      createdAt: now,
      amountCents: null,
      capitalDeltaCents: 0,
      capitalAfterCents: anchor.currentCapitalCents,
      statusAfter: anchor.status,
      relatedBetId: null,
      relatedBranchId: null,
      description: `Unarchived: ${entry.label} (${restored.bets.length} ticket(s), ${
        restored.branches.length
      } branch(es), BANK ${fmt(bankCents)})`,
      metadata: {
        kind: "UNARCHIVE",
        archiveId: entry.id,
        correctionEventId: marker?.id ?? null,
        restoredTickets: restored.bets.length,
        restoredBranches: restored.branches.length,
        restoredBankCents: bankCents,
      },
    });
  }

  const problems = findIntegrityProblems(state, ctx.workspace);
  if (problems.length > 0) {
    throw new DomainError("INVALID_STATE", `Cannot unarchive safely: ${problems[0]}`, { problems });
  }
  return {
    label: entry.label,
    branches: restored.branches.length,
    tickets: restored.bets.length,
    bankCents,
  };
}

export const unarchiveCandidateSchema = z.object({ id: z.string().min(1) });

/** Bring an archived candidate back into the shadow portfolio. */
export function unarchiveCandidate(
  state: WorkspaceState,
  input: z.input<typeof unarchiveCandidateSchema>,
  ctx: OpContext,
): string {
  const { id } = parseInput(unarchiveCandidateSchema, input);
  const candidate = getCandidateOrThrow(state, id);
  if (candidate.archivedAt === null) {
    throw new DomainError("INVALID_STATE", "This candidate is not archived");
  }
  if (candidate.convertedBetId && !state.bets.some((b) => b.id === candidate.convertedBetId)) {
    throw new DomainError(
      "INVALID_STATE",
      "Cannot unarchive safely: the ticket this candidate was played as no longer exists",
    );
  }
  candidate.archivedAt = null;
  candidate.updatedAt = ctx.now.getTime();
  return candidate.eventName;
}
