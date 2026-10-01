import { z } from "zod";
import type { BranchStatus } from "@/domain/types";
import { findIntegrityProblems } from "../state/integrity";
import { replayBranch } from "../state/replay";
import type {
  ArchiveEntry,
  BetRecord,
  BranchEventRecord,
  BranchRecord,
  WorkspaceState,
} from "../state/schema";
import { getCandidateOrThrow, purgeCandidate } from "./candidate-service";
import { DomainError, notFound } from "./errors";
import {
  getBetOrThrow,
  getBranchOrThrow,
  moneyFormatter,
  newId,
  parseInput,
  pushEvent,
  type OpContext,
} from "./internal";

/**
 * Corrections of money-carrying history: "DELETE / REBUILD FROM THIS POINT".
 *
 * A financial record is never edited in place. Correcting it removes it together with
 * everything that depends on it — on its branch every later event and ticket, and the whole
 * subtree of every child born from the removed part, with the BANK money they produced — then
 * the branch is rebuilt from its remaining event log. Nothing can be left orphaned and no BANK
 * money can survive without the ticket that produced it.
 *
 *   REOPEN_TICKET      settled ticket → PENDING again (its consequences and later history go)
 *   DELETE_TICKET      remove a ticket and everything after it on its branch
 *   DELETE_FROM_EVENT  remove a manual adjustment / manual BANK transfer / profile or status
 *                      change, and everything after it on its branch
 *   DELETE_BRANCH      remove a root branch with its entire subtree
 *
 * Mode ARCHIVE (default) moves the removed records to `state.archive` (restorable with
 * Unarchive, see unarchive-service); PURGE drops them. Every correction runs after an automatic
 * snapshot, so it can be undone.
 */

export const DELETE_MODES = ["ARCHIVE", "PURGE"] as const;
export type DeleteMode = (typeof DELETE_MODES)[number];

export const correctionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("REOPEN_TICKET"), betId: z.string().min(1) }),
  z.object({ kind: z.literal("DELETE_TICKET"), betId: z.string().min(1) }),
  z.object({ kind: z.literal("DELETE_FROM_EVENT"), eventId: z.int().positive() }),
  z.object({ kind: z.literal("DELETE_BRANCH"), branchId: z.string().min(1) }),
]);
export type CorrectionTarget = z.input<typeof correctionTargetSchema>;

export const applyCorrectionSchema = z.object({
  target: correctionTargetSchema,
  mode: z.enum(DELETE_MODES).default("ARCHIVE"),
  reason: z.string().trim().max(500).optional(),
  /** Typed confirmation, required for PURGE (see `CorrectionImpact.confirmationText`). */
  confirmation: z.string().trim().max(64).optional(),
});
export type ApplyCorrectionInput = z.input<typeof applyCorrectionSchema>;

/** Events that can start a "delete from here" on their own. */
const CUTTABLE_EVENT_TYPES = new Set([
  "MANUAL_ADJUSTMENT",
  "BANK_TRANSFER",
  "PROFILE_CHANGED",
  "STATUS_CHANGED",
]);
const SETTLEMENT_TYPES = new Set(["BET_WON", "BET_LOST", "BET_VOID"]);

interface CascadePlan {
  label: string;
  /** Branch rebuilt after the cut (null when a whole root subtree goes). */
  branchId: string | null;
  removedEventIds: Set<number>;
  removedBetIds: Set<string>;
  revertedBetIds: Set<string>;
  removedBranchIds: Set<string>;
  removedBankIds: Set<string>;
  confirmationText: string;
}

export interface CorrectionImpact {
  kind: CorrectionTarget["kind"];
  label: string;
  branch: {
    id: string;
    code: string;
    capitalBeforeCents: number;
    capitalAfterCents: number;
    statusBefore: BranchStatus;
    statusAfter: BranchStatus;
  } | null;
  removedTickets: {
    id: string;
    branchCode: string;
    roundNumber: number;
    eventName: string;
    result: string;
    cancelled: boolean;
  }[];
  reopenedTickets: {
    id: string;
    branchCode: string;
    roundNumber: number;
    eventName: string;
    result: string;
  }[];
  removedBranches: {
    id: string;
    code: string;
    profile: string;
    status: BranchStatus;
    capitalCents: number;
  }[];
  removedEvents: number;
  bank: { count: number; amountCents: number; withdrawnCents: number };
  activeCapitalDeltaCents: number;
  unlinkedCandidates: number;
  warnings: string[];
  /** Text the user must type to confirm a permanent purge. */
  confirmationText: string;
}

function eventsOf(state: WorkspaceState, branchId: string): BranchEventRecord[] {
  return state.branchEvents.filter((e) => e.branchId === branchId).sort((a, b) => a.id - b.id);
}

function subtreeIds(state: WorkspaceState, rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    out.push(id);
    for (const b of state.branches) if (b.parentId === id) stack.push(b.id);
  }
  return out;
}

function ticketTag(state: WorkspaceState, bet: BetRecord, branch: BranchRecord): string {
  return `${branch.code}·${state.settings.roundShortLabel}${bet.roundNumber}`;
}

function emptyPlan(label: string, branchId: string | null, confirmationText: string): CascadePlan {
  return {
    label,
    branchId,
    removedEventIds: new Set(),
    removedBetIds: new Set(),
    revertedBetIds: new Set(),
    removedBranchIds: new Set(),
    removedBankIds: new Set(),
    confirmationText,
  };
}

/** Remove whole subtrees (branches, their tickets, events and BANK entries). */
function addSubtree(state: WorkspaceState, plan: CascadePlan, rootId: string): void {
  for (const id of subtreeIds(state, rootId)) {
    plan.removedBranchIds.add(id);
    for (const bet of state.bets) if (bet.branchId === id) plan.removedBetIds.add(bet.id);
    for (const e of state.branchEvents) if (e.branchId === id) plan.removedEventIds.add(e.id);
    for (const t of state.bankTransactions) if (t.branchId === id) plan.removedBankIds.add(t.id);
  }
}

/** Cut a branch's history at `cutEventId` (inclusive) and collect every dependent record. */
function planCut(
  state: WorkspaceState,
  branch: BranchRecord,
  cutEventId: number,
  plan: CascadePlan,
): void {
  const events = eventsOf(state, branch.id);
  const removed = events.filter((e) => e.id >= cutEventId);
  for (const e of removed) plan.removedEventIds.add(e.id);

  for (const bet of state.bets) {
    if (bet.branchId !== branch.id) continue;
    const own = events.filter((e) => e.relatedBetId === bet.id);
    const created = own.find((e) => e.type === "BET_CREATED");
    if (created && created.id >= cutEventId) {
      plan.removedBetIds.add(bet.id);
    } else if (
      own.some(
        (e) => e.id >= cutEventId && (SETTLEMENT_TYPES.has(e.type) || e.type === "BET_CANCELLED"),
      )
    ) {
      plan.revertedBetIds.add(bet.id);
    }
  }

  for (const e of removed) {
    if (e.type === "CHILD_CREATED" && e.relatedBranchId) addSubtree(state, plan, e.relatedBranchId);
    const txId = e.metadata?.bankTransactionId;
    if (typeof txId === "string") plan.removedBankIds.add(txId);
  }
  for (const child of state.branches) {
    if (child.parentId !== branch.id || !child.birthBetId) continue;
    if (plan.removedBetIds.has(child.birthBetId) || plan.revertedBetIds.has(child.birthBetId)) {
      addSubtree(state, plan, child.id);
    }
  }
  for (const t of state.bankTransactions) {
    if (t.branchId !== branch.id || !t.relatedBetId) continue;
    if (plan.removedBetIds.has(t.relatedBetId) || plan.revertedBetIds.has(t.relatedBetId)) {
      plan.removedBankIds.add(t.id);
    }
  }
}

function buildPlan(
  state: WorkspaceState,
  target: z.output<typeof correctionTargetSchema>,
): CascadePlan {
  switch (target.kind) {
    case "REOPEN_TICKET":
    case "DELETE_TICKET": {
      const bet = getBetOrThrow(state, target.betId);
      const branch = getBranchOrThrow(state, bet.branchId);
      const tag = ticketTag(state, bet, branch);
      const own = eventsOf(state, branch.id).filter((e) => e.relatedBetId === bet.id);
      if (target.kind === "REOPEN_TICKET") {
        if (bet.result === "PENDING" || bet.cancelledAt !== null) {
          throw new DomainError("INVALID_STATE", "Only settled tickets can be reopened");
        }
        const settlement = own.find((e) => SETTLEMENT_TYPES.has(e.type));
        if (!settlement)
          throw new DomainError("INVALID_STATE", `${tag}: settlement events not found`);
        const plan = emptyPlan(`Reopened ${tag} (${bet.result} → PENDING)`, branch.id, branch.code);
        planCut(state, branch, settlement.id, plan);
        plan.revertedBetIds.add(bet.id);
        return plan;
      }
      if (bet.result === "PENDING") {
        // A pending or cancelled ticket never moved money: only the ticket itself goes.
        const plan = emptyPlan(
          `Deleted ${bet.cancelledAt !== null ? "cancelled" : "pending"} ticket ${tag}`,
          branch.id,
          branch.code,
        );
        plan.removedBetIds.add(bet.id);
        for (const e of own) plan.removedEventIds.add(e.id);
        return plan;
      }
      const created = own.find((e) => e.type === "BET_CREATED");
      if (!created) throw new DomainError("INVALID_STATE", `${tag}: creation event not found`);
      const plan = emptyPlan(`Deleted ${tag} and everything after it`, branch.id, branch.code);
      planCut(state, branch, created.id, plan);
      plan.removedBetIds.add(bet.id);
      return plan;
    }
    case "DELETE_FROM_EVENT": {
      const event = state.branchEvents.find((e) => e.id === target.eventId);
      if (!event) throw notFound("Event", String(target.eventId));
      const branch = getBranchOrThrow(state, event.branchId);
      if (!CUTTABLE_EVENT_TYPES.has(event.type) || event.relatedBetId !== null) {
        throw new DomainError(
          "INVALID_STATE",
          "Only manual adjustments, manual BANK transfers and profile/status changes can be deleted from the event log. Correct tickets from the ticket itself.",
        );
      }
      if (event.type === "MANUAL_ADJUSTMENT" && event.metadata?.kind !== "CAPITAL_CORRECTION") {
        throw new DomainError(
          "INVALID_STATE",
          "Correction / unarchive journal entries cannot be deleted — use Undo instead",
        );
      }
      const plan = emptyPlan(
        `Deleted ${branch.code} event #${event.id} (${event.type}) and everything after it`,
        branch.id,
        branch.code,
      );
      planCut(state, branch, event.id, plan);
      return plan;
    }
    case "DELETE_BRANCH": {
      const branch = getBranchOrThrow(state, target.branchId);
      if (branch.parentId !== null) {
        throw new DomainError(
          "INVALID_STATE",
          `${branch.code} was created by a ticket of its parent: delete it from that ticket (“Delete from here”).`,
          { birthBetId: branch.birthBetId },
        );
      }
      const plan = emptyPlan(
        `Deleted root branch ${branch.code} and its subtree`,
        null,
        branch.code,
      );
      addSubtree(state, plan, branch.id);
      return plan;
    }
  }
}

function revertToPending(bet: BetRecord, now: number): void {
  Object.assign(bet, {
    result: "PENDING",
    settledAt: null,
    actualReturnCents: null,
    profitLossCents: null,
    capitalAfterCents: null,
    countsAsRound: null,
    cancelledAt: null,
    cancelReason: null,
    updatedAt: now,
  } satisfies Partial<BetRecord>);
}

/** Rebuild a branch's event-driven fields from its remaining history. */
export function rebuildBranch(state: WorkspaceState, branch: BranchRecord, now: number): void {
  const replayed = replayBranch(branch, eventsOf(state, branch.id));
  Object.assign(branch, replayed, {
    totalBankGeneratedCents: state.bankTransactions
      .filter((t) => t.branchId === branch.id)
      .reduce((s, t) => s + t.amountCents, 0),
    totalChildCapitalGeneratedCents: state.branches
      .filter((b) => b.parentId === branch.id)
      .reduce((s, b) => s + b.birthCapitalCents, 0),
    updatedAt: now,
  });
}

interface AppliedCorrection {
  plan: CascadePlan;
  archive: ArchiveEntry;
  unlinkedCandidates: number;
}

function applyPlan(
  state: WorkspaceState,
  plan: CascadePlan,
  mode: DeleteMode,
  reason: string | undefined,
  ctx: OpContext,
): AppliedCorrection {
  const now = ctx.now.getTime();
  const archive: ArchiveEntry = {
    id: newId(),
    at: now,
    label: reason ? `${plan.label} — ${reason}` : plan.label,
    branches: state.branches.filter((b) => plan.removedBranchIds.has(b.id)),
    bets: state.bets
      .filter((b) => plan.removedBetIds.has(b.id) || plan.revertedBetIds.has(b.id))
      .map((b) => structuredClone(b)),
    bankTransactions: state.bankTransactions.filter((t) => plan.removedBankIds.has(t.id)),
    branchEvents: state.branchEvents.filter((e) => plan.removedEventIds.has(e.id)),
    candidates: [],
  };

  state.branches = state.branches.filter((b) => !plan.removedBranchIds.has(b.id));
  state.bets = state.bets.filter((b) => !plan.removedBetIds.has(b.id));
  state.bankTransactions = state.bankTransactions.filter((t) => !plan.removedBankIds.has(t.id));
  state.branchEvents = state.branchEvents.filter((e) => !plan.removedEventIds.has(e.id));
  for (const bet of state.bets) if (plan.revertedBetIds.has(bet.id)) revertToPending(bet, now);

  let unlinkedCandidates = 0;
  for (const c of state.candidates) {
    if (c.convertedBetId && plan.removedBetIds.has(c.convertedBetId)) {
      // Keep the link in the archive so an unarchive can restore it.
      archive.candidates.push(structuredClone(c));
      c.convertedBetId = null;
      c.updatedAt = now;
      unlinkedCandidates += 1;
    }
  }

  if (plan.branchId) {
    const branch = getBranchOrThrow(state, plan.branchId);
    rebuildBranch(state, branch, now);
    const fmt = moneyFormatter(state.settings);
    const removedBank = archive.bankTransactions.reduce((s, t) => s + t.amountCents, 0);
    pushEvent(state, {
      branchId: branch.id,
      type: "MANUAL_ADJUSTMENT",
      createdAt: now,
      amountCents: null,
      capitalDeltaCents: 0,
      capitalAfterCents: branch.currentCapitalCents,
      statusAfter: branch.status,
      relatedBetId: null,
      relatedBranchId: null,
      description: `Correction: ${plan.label.charAt(0).toLowerCase()}${plan.label.slice(1)} (${
        mode === "PURGE" ? "permanently deleted" : "archived"
      }; ${archive.bets.length} ticket(s), ${archive.branches.length} branch(es), BANK ${fmt(-removedBank, true)})${
        reason ? ` — ${reason}` : ""
      }`,
      metadata: {
        kind: "CORRECTION",
        mode,
        archiveId: mode === "ARCHIVE" ? archive.id : null,
        removedTickets: archive.bets.length,
        removedBranches: archive.branches.length,
        removedBankCents: removedBank,
        reason: reason ?? null,
      },
    });
  }

  if (mode === "ARCHIVE") state.archive.push(archive);
  return { plan, archive, unlinkedCandidates };
}

function describeImpact(
  before: WorkspaceState,
  after: WorkspaceState,
  target: z.output<typeof correctionTargetSchema>,
  applied: AppliedCorrection,
): CorrectionImpact {
  const { plan, archive } = applied;
  const codeOf = new Map(before.branches.map((b) => [b.id, b.code]));
  const activeCapital = (s: WorkspaceState) =>
    s.branches
      .filter((b) => b.status !== "DEAD")
      .reduce((sum, b) => sum + b.currentCapitalCents, 0);
  const branchBefore = plan.branchId
    ? before.branches.find((b) => b.id === plan.branchId)
    : undefined;
  const branchAfter = plan.branchId
    ? after.branches.find((b) => b.id === plan.branchId)
    : undefined;
  const fmt = moneyFormatter(before.settings);
  const withdrawnCents = archive.bankTransactions
    .filter((t) => t.status === "WITHDRAWN")
    .reduce((s, t) => s + t.amountCents, 0);
  const warnings: string[] = [];
  if (withdrawnCents > 0) {
    warnings.push(
      `${fmt(withdrawnCents)} of the removed BANK money is already marked WITHDRAWN from Winamax. The withdrawal itself is real: re-enter the corrected history so the BANK matches reality.`,
    );
  }
  const removedPending = archive.bets.filter(
    (b) => plan.removedBetIds.has(b.id) && b.result === "PENDING" && !b.cancelledAt,
  );
  if (removedPending.length > 0 && target.kind !== "DELETE_TICKET") {
    warnings.push(`${removedPending.length} pending ticket(s) will be removed as well.`);
  }
  const ticketRow = (b: BetRecord) => ({
    id: b.id,
    branchCode: codeOf.get(b.branchId) ?? "?",
    roundNumber: b.roundNumber,
    eventName: b.eventName,
    result: b.result,
  });
  return {
    kind: target.kind,
    label: plan.label,
    branch:
      branchBefore && branchAfter
        ? {
            id: branchBefore.id,
            code: branchBefore.code,
            capitalBeforeCents: branchBefore.currentCapitalCents,
            capitalAfterCents: branchAfter.currentCapitalCents,
            statusBefore: branchBefore.status,
            statusAfter: branchAfter.status,
          }
        : null,
    removedTickets: archive.bets
      .filter((b) => plan.removedBetIds.has(b.id))
      .map((b) => ({ ...ticketRow(b), cancelled: b.cancelledAt !== null })),
    reopenedTickets: archive.bets.filter((b) => plan.revertedBetIds.has(b.id)).map(ticketRow),
    removedBranches: archive.branches.map((b) => ({
      id: b.id,
      code: b.code,
      profile: b.profile,
      status: b.status,
      capitalCents: b.currentCapitalCents,
    })),
    removedEvents: archive.branchEvents.length,
    bank: {
      count: archive.bankTransactions.length,
      amountCents: archive.bankTransactions.reduce((s, t) => s + t.amountCents, 0),
      withdrawnCents,
    },
    activeCapitalDeltaCents: activeCapital(after) - activeCapital(before),
    unlinkedCandidates: applied.unlinkedCandidates,
    warnings,
    confirmationText: plan.confirmationText,
  };
}

/**
 * Dry run: apply the correction to a copy and report exactly what would change. The copy is
 * also integrity-checked, so a correction that would corrupt the ledger is refused up front.
 */
export function previewCorrection(
  state: WorkspaceState,
  input: CorrectionTarget,
  ctx: OpContext,
): CorrectionImpact {
  const target = parseInput(correctionTargetSchema, input);
  const draft = structuredClone(state) as WorkspaceState;
  const plan = buildPlan(draft, target);
  const applied = applyPlan(draft, plan, "ARCHIVE", undefined, ctx);
  const problems = findIntegrityProblems(draft, ctx.workspace);
  if (problems.length > 0) {
    throw new DomainError(
      "STATE_INVALID",
      `This correction would break the ledger: ${problems[0]}`,
      { problems },
    );
  }
  return describeImpact(state, draft, target, applied);
}

export interface CorrectionResult {
  label: string;
  mode: DeleteMode;
  archiveId: string | null;
  removedTickets: number;
  removedBranches: number;
  removedBankCents: number;
}

export function applyCorrection(
  state: WorkspaceState,
  input: ApplyCorrectionInput,
  ctx: OpContext,
): CorrectionResult {
  const data = parseInput(applyCorrectionSchema, input);
  const plan = buildPlan(state, data.target);
  if (
    data.mode === "PURGE" &&
    data.confirmation !== plan.confirmationText &&
    data.confirmation !== "DELETE"
  ) {
    throw new DomainError(
      "VALIDATION",
      `Type ${plan.confirmationText} (or DELETE) to confirm the permanent deletion`,
    );
  }
  const { archive } = applyPlan(state, plan, data.mode, data.reason, ctx);
  return {
    label: plan.label,
    mode: data.mode,
    archiveId: data.mode === "ARCHIVE" ? archive.id : null,
    removedTickets: archive.bets.length,
    removedBranches: archive.branches.length,
    removedBankCents: archive.bankTransactions.reduce((s, t) => s + t.amountCents, 0),
  };
}

/* -------------------------------- candidates ------------------------------- */

export const deleteCandidateSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(DELETE_MODES).default("ARCHIVE"),
  confirmation: z.string().trim().max(64).optional(),
});

export function deleteCandidate(
  state: WorkspaceState,
  input: z.input<typeof deleteCandidateSchema>,
  ctx: OpContext,
): string {
  const data = parseInput(deleteCandidateSchema, input);
  const candidate = getCandidateOrThrow(state, data.id);
  if (data.mode === "PURGE") {
    if (data.confirmation !== "DELETE")
      throw new DomainError("VALIDATION", "Type DELETE to confirm");
    purgeCandidate(state, candidate.id);
    return `Permanently deleted candidate ${candidate.eventName}`;
  }
  candidate.archivedAt = ctx.now.getTime();
  candidate.updatedAt = candidate.archivedAt;
  return `Archived candidate ${candidate.eventName}`;
}

/* ---------------------------------- archive -------------------------------- */

export const purgeArchiveSchema = z.object({
  archiveId: z.string().min(1),
  confirmation: z.string().trim().max(64),
});

/** Permanently drop an archived correction (its records are gone for good afterwards). */
export function purgeArchiveEntry(
  state: WorkspaceState,
  input: z.input<typeof purgeArchiveSchema>,
): ArchiveEntry {
  const data = parseInput(purgeArchiveSchema, input);
  if (data.confirmation !== "DELETE") throw new DomainError("VALIDATION", "Type DELETE to confirm");
  const entry = state.archive.find((a) => a.id === data.archiveId);
  if (!entry) throw notFound("Archive entry", data.archiveId);
  state.archive = state.archive.filter((a) => a.id !== entry.id);
  return entry;
}

/** Records removed by corrections, newest first (read-only, for inspection). */
export function listArchive(state: WorkspaceState): ArchiveEntry[] {
  return [...state.archive].sort((a, b) => b.at - a.at);
}
