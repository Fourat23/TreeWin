import { z } from "zod";
import { nextRootCode } from "@/domain/branches/codes";
import { BANK_DESTINATIONS, PROFILES, type BranchStatus } from "@/domain/types";
import type { BranchRecord, WorkspaceState } from "../state/schema";
import { DomainError } from "./errors";
import {
  getBranchOrThrow,
  moneyFormatter,
  newId,
  parseInput,
  pendingTicketOf,
  pushEvent,
  strategyStamp,
  type OpContext,
} from "./internal";

const MAX_CAPITAL_CENTS = 10_000_000_000;

export const createRootBranchSchema = z.object({
  profile: z.enum(PROFILES),
  capitalCents: z
    .int()
    .min(100, { error: "Initial capital must be at least 1.00" })
    .max(MAX_CAPITAL_CENTS),
  notes: z.string().trim().max(2_000).optional(),
});
export type CreateRootBranchInput = z.input<typeof createRootBranchSchema>;

/**
 * Every branch code ever assigned in the workspace: the tombstone registry plus, defensively,
 * live and archived branches. Codes are reserved forever (death, archive, correction, purge).
 */
export function reservedBranchCodes(state: WorkspaceState): Set<string> {
  return new Set([
    ...state.metadata.reservedCodes,
    ...state.branches.map((b) => b.code),
    ...state.archive.flatMap((a) => a.branches.map((b) => b.code)),
  ]);
}

/** Record a newly assigned code in the registry (never removed afterwards). */
export function reserveBranchCode(state: WorkspaceState, code: string): void {
  if (reservedBranchCodes(state).has(code)) {
    throw new DomainError("INVALID_STATE", `Branch code ${code} has already been used`);
  }
  state.metadata.reservedCodes.push(code);
}

export const FUNDING_LOCKED_MESSAGE =
  "REAL external funding is already locked. CELLTREE receives external capital only once. New branches must now be created by strategy splits.";

/** Whether a manual root branch may be created in this workspace right now. */
export function canCreateRootBranch(state: WorkspaceState): boolean {
  return state.workspace === "DEMO" || !state.metadata.initialFunding.consumed;
}

/**
 * Create a root branch. This is the only way external money enters the ecosystem; BANK money
 * can never be used here.
 *
 * REAL: external capital enters exactly once — a single root funded with exactly the €100 seed
 * (root A of a fresh ledger). That consumes the ledger's funding for good: deleting, archiving,
 * correcting or killing the root never unlocks it (only a Factory Reset starts a new ledger).
 * DEMO: any number of roots, any amount (experiments).
 */
export function createRootBranch(
  state: WorkspaceState,
  input: CreateRootBranchInput,
  ctx: OpContext,
): BranchRecord {
  const data = parseInput(createRootBranchSchema, input);
  const fmt = moneyFormatter(state.settings);
  const now = ctx.now.getTime();
  const real = ctx.workspace === "REAL";
  if (real) {
    const funding = state.metadata.initialFunding;
    if (funding.consumed) throw new DomainError("FUNDING_LOCKED", FUNDING_LOCKED_MESSAGE);
    if (data.capitalCents !== funding.amountCents) {
      throw new DomainError(
        "VALIDATION",
        `The REAL root is funded with exactly ${fmt(funding.amountCents)} of external seed capital (fixed by REAL V1)`,
      );
    }
  }
  const code = nextRootCode([...reservedBranchCodes(state)]);
  const capCents = state.settings.profiles[data.profile].capCents;
  const branch: BranchRecord = {
    id: newId(),
    code,
    parentId: null,
    generation: 0,
    profile: data.profile,
    status: "ACTIVE",
    birthReason: "ROOT",
    birthBetId: null,
    birthEventId: null,
    birthCapitalCents: data.capitalCents,
    currentCapitalCents: data.capitalCents,
    capCents,
    peakCapitalCents: data.capitalCents,
    p1Done: !state.settings.p1.enabled,
    thresholdLevel: 0,
    totalBankGeneratedCents: 0,
    totalChildCapitalGeneratedCents: 0,
    totalLostCents: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    roundCount: 0,
    childCount: 0,
    createdAt: now,
    updatedAt: now,
    maturedAt: null,
    diedAt: null,
    lastRoundAt: null,
    notes: data.notes ?? null,
    ...strategyStamp(state),
  };
  reserveBranchCode(state, code);
  state.branches.push(branch);
  if (real) {
    state.metadata.initialFunding = {
      ...state.metadata.initialFunding,
      consumed: true,
      consumedAt: now,
      rootBranchId: branch.id,
    };
  }
  branch.birthEventId = pushEvent(state, {
    branchId: branch.id,
    type: "BIRTH",
    createdAt: now,
    amountCents: data.capitalCents,
    capitalDeltaCents: data.capitalCents,
    capitalAfterCents: data.capitalCents,
    statusAfter: "ACTIVE",
    relatedBetId: null,
    relatedBranchId: null,
    description: `Root branch ${code} created with ${fmt(data.capitalCents)} (${data.profile.toLowerCase()})${
      real ? " — the single REAL external seed; external funding is now locked" : ""
    }`,
    metadata: {
      reason: "ROOT",
      profile: data.profile,
      capCents,
      p1Done: branch.p1Done,
      externalSeed: real,
    },
  });
  return branch;
}

function assertNotDead(branch: BranchRecord): void {
  if (branch.status === "DEAD") throw new DomainError("INVALID_STATE", "Dead branches are frozen");
}

function assertNoPending(state: WorkspaceState, branch: BranchRecord): void {
  if (pendingTicketOf(state, branch.id)) {
    throw new DomainError("PENDING_EXISTS", "Settle or cancel the pending ticket first");
  }
}

export const setPausedSchema = z.object({
  branchId: z.string().min(1),
  paused: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/** Pause / resume a branch. A paused branch keeps its capital but cannot open rounds. */
export function setBranchPaused(
  state: WorkspaceState,
  input: z.input<typeof setPausedSchema>,
  ctx: OpContext,
): BranchRecord {
  const data = parseInput(setPausedSchema, input);
  const branch = getBranchOrThrow(state, data.branchId);
  let nextStatus: BranchStatus;
  if (data.paused) {
    if (branch.status !== "ACTIVE" && branch.status !== "MATURE") {
      throw new DomainError("INVALID_STATE", `Cannot pause a ${branch.status} branch`);
    }
    assertNoPending(state, branch);
    nextStatus = "PAUSED";
  } else {
    if (branch.status !== "PAUSED") {
      throw new DomainError("INVALID_STATE", "Only paused branches can be resumed");
    }
    nextStatus = branch.maturedAt ? "MATURE" : "ACTIVE";
  }
  const previous = branch.status;
  branch.status = nextStatus;
  branch.updatedAt = ctx.now.getTime();
  pushEvent(state, {
    branchId: branch.id,
    type: "STATUS_CHANGED",
    createdAt: ctx.now.getTime(),
    amountCents: null,
    capitalDeltaCents: 0,
    capitalAfterCents: branch.currentCapitalCents,
    statusAfter: nextStatus,
    relatedBetId: null,
    relatedBranchId: null,
    description: `${branch.code} ${data.paused ? "paused" : "resumed"} (${previous} → ${nextStatus})${
      data.reason ? ` — ${data.reason}` : ""
    }`,
    metadata: { from: previous, to: nextStatus, reason: data.reason ?? null },
  });
  return branch;
}

export const changeProfileSchema = z.object({
  branchId: z.string().min(1),
  profile: z.enum(PROFILES),
  reason: z.string().trim().min(3, { error: "A reason is required for a profile change" }).max(500),
  applyProfileCap: z.boolean().default(false),
});

/**
 * Exceptional manual profile change (profiles are fixed at birth by default).
 * Always journaled with a PROFILE_CHANGED event.
 */
export function changeBranchProfile(
  state: WorkspaceState,
  input: z.input<typeof changeProfileSchema>,
  ctx: OpContext,
): BranchRecord {
  const data = parseInput(changeProfileSchema, input);
  const fmt = moneyFormatter(state.settings);
  const branch = getBranchOrThrow(state, data.branchId);
  assertNotDead(branch);
  if (branch.profile === data.profile) {
    throw new DomainError("VALIDATION", `${branch.code} already has the ${data.profile} profile`);
  }
  const capCents = data.applyProfileCap
    ? state.settings.profiles[data.profile].capCents
    : branch.capCents;
  if (capCents < branch.currentCapitalCents) {
    throw new DomainError("INVALID_STATE", "The new cap would be below the current capital");
  }
  const previous = { profile: branch.profile, capCents: branch.capCents };
  branch.profile = data.profile;
  branch.capCents = capCents;
  branch.updatedAt = ctx.now.getTime();
  pushEvent(state, {
    branchId: branch.id,
    type: "PROFILE_CHANGED",
    createdAt: ctx.now.getTime(),
    amountCents: null,
    capitalDeltaCents: 0,
    capitalAfterCents: branch.currentCapitalCents,
    statusAfter: branch.status,
    relatedBetId: null,
    relatedBranchId: null,
    description: `Profile changed ${previous.profile} → ${data.profile}${
      capCents !== previous.capCents ? `, cap ${fmt(previous.capCents)} → ${fmt(capCents)}` : ""
    } — ${data.reason}`,
    metadata: {
      from: previous.profile,
      to: data.profile,
      previousCapCents: previous.capCents,
      capCents,
      reason: data.reason,
    },
  });
  return branch;
}

export const adjustCapitalSchema = z.object({
  branchId: z.string().min(1),
  deltaCents: z.int().refine((v) => v !== 0, { error: "Adjustment cannot be zero" }),
  reason: z.string().trim().min(3, { error: "A reason is required" }).max(500),
});

/**
 * Explicit correction of a branch capital (data-entry error, Winamax adjustment…).
 * Never touches the BANK and is always journaled as MANUAL_ADJUSTMENT.
 */
export function adjustBranchCapital(
  state: WorkspaceState,
  input: z.input<typeof adjustCapitalSchema>,
  ctx: OpContext,
): BranchRecord {
  const data = parseInput(adjustCapitalSchema, input);
  const fmt = moneyFormatter(state.settings);
  const branch = getBranchOrThrow(state, data.branchId);
  assertNotDead(branch);
  assertNoPending(state, branch);
  const next = branch.currentCapitalCents + data.deltaCents;
  if (next <= 0) throw new DomainError("VALIDATION", "Capital must stay above zero");
  if (next > branch.capCents) {
    throw new DomainError("VALIDATION", `Capital cannot exceed the cap (${fmt(branch.capCents)})`);
  }
  branch.currentCapitalCents = next;
  branch.peakCapitalCents = Math.max(branch.peakCapitalCents, next);
  branch.updatedAt = ctx.now.getTime();
  pushEvent(state, {
    branchId: branch.id,
    type: "MANUAL_ADJUSTMENT",
    createdAt: ctx.now.getTime(),
    amountCents: Math.abs(data.deltaCents),
    capitalDeltaCents: data.deltaCents,
    capitalAfterCents: next,
    statusAfter: branch.status,
    relatedBetId: null,
    relatedBranchId: null,
    description: `Manual capital correction ${fmt(data.deltaCents, true)} (not funding) — ${data.reason}`,
    // A correction of recorded history, never a funding event: initialFunding is untouched.
    metadata: { kind: "CAPITAL_CORRECTION", reason: data.reason, funding: false },
  });
  return branch;
}

export const manualBankTransferSchema = z.object({
  branchId: z.string().min(1),
  amountCents: z.int().min(1),
  destination: z.enum(BANK_DESTINATIONS).default("UNALLOCATED"),
  reason: z.string().trim().min(3, { error: "A reason is required" }).max(500),
});

/** Manually secure part of a branch capital into the BANK (one-way, never reversible). */
export function transferToBank(
  state: WorkspaceState,
  input: z.input<typeof manualBankTransferSchema>,
  ctx: OpContext,
): BranchRecord {
  const data = parseInput(manualBankTransferSchema, input);
  const fmt = moneyFormatter(state.settings);
  const branch = getBranchOrThrow(state, data.branchId);
  assertNotDead(branch);
  assertNoPending(state, branch);
  if (data.amountCents >= branch.currentCapitalCents) {
    throw new DomainError("VALIDATION", "Keep some capital in the branch (amount must be lower)");
  }
  const now = ctx.now.getTime();
  const transactionId = newId();
  state.bankTransactions.push({
    id: transactionId,
    branchId: branch.id,
    relatedBetId: null,
    amountCents: data.amountCents,
    createdAt: now,
    type: "MANUAL",
    harvestKind: null,
    profile: branch.profile,
    status: "SECURED",
    withdrawnAt: null,
    destination: data.destination,
    notes: data.reason,
  });
  branch.currentCapitalCents -= data.amountCents;
  branch.totalBankGeneratedCents += data.amountCents;
  branch.updatedAt = now;
  pushEvent(state, {
    branchId: branch.id,
    type: "BANK_TRANSFER",
    createdAt: now,
    amountCents: data.amountCents,
    capitalDeltaCents: -data.amountCents,
    capitalAfterCents: branch.currentCapitalCents,
    statusAfter: branch.status,
    relatedBetId: null,
    relatedBranchId: null,
    description: `Manual transfer ${fmt(data.amountCents, true)} secured to BANK — ${data.reason}`,
    metadata: { kind: "MANUAL", reason: data.reason, bankTransactionId: transactionId },
  });
  return branch;
}

export const updateBranchNotesSchema = z.object({
  branchId: z.string().min(1),
  notes: z.string().trim().max(2_000),
});

export function updateBranchNotes(
  state: WorkspaceState,
  input: z.input<typeof updateBranchNotesSchema>,
  ctx: OpContext,
): BranchRecord {
  const data = parseInput(updateBranchNotesSchema, input);
  const branch = getBranchOrThrow(state, data.branchId);
  branch.notes = data.notes || null;
  branch.updatedAt = ctx.now.getTime();
  return branch;
}
