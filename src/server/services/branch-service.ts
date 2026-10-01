import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { nextRootCode } from "@/domain/branches/codes";
import { BANK_DESTINATIONS, PROFILES, type BranchStatus } from "@/domain/types";
import type { Db } from "../db/client";
import { bankTransactions, branches, type BranchRow } from "../db/schema";
import { DomainError } from "./errors";
import {
  getBranchOrThrow,
  hasPendingTicket,
  insertEvent,
  moneyFormatter,
  newId,
  parseInput,
} from "./internal";
import { getSettings } from "./settings-service";

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
 * Create a new root branch (A, B, C…). This is the only way external money enters the
 * ecosystem; BANK money can never be used here.
 */
export function createRootBranch(
  db: Db,
  input: CreateRootBranchInput,
  now = new Date(),
): BranchRow {
  const data = parseInput(createRootBranchSchema, input);
  const settings = getSettings(db);
  const fmt = moneyFormatter(settings);
  return db.transaction((tx) => {
    const roots = tx
      .select({ code: branches.code })
      .from(branches)
      .where(isNull(branches.parentId))
      .all();
    const code = nextRootCode(roots.map((r) => r.code));
    const id = newId();
    const capCents = settings.profiles[data.profile].capCents;
    tx.insert(branches)
      .values({
        id,
        code,
        parentId: null,
        generation: 0,
        profile: data.profile,
        status: "ACTIVE",
        birthReason: "ROOT",
        birthCapitalCents: data.capitalCents,
        currentCapitalCents: data.capitalCents,
        capCents,
        peakCapitalCents: data.capitalCents,
        p1Done: !settings.p1.enabled,
        createdAt: now,
        updatedAt: now,
        notes: data.notes ?? null,
      })
      .run();
    const birthEventId = insertEvent(tx, {
      branchId: id,
      type: "BIRTH",
      createdAt: now,
      amountCents: data.capitalCents,
      capitalDeltaCents: data.capitalCents,
      capitalAfterCents: data.capitalCents,
      statusAfter: "ACTIVE",
      description: `Root branch ${code} created with ${fmt(data.capitalCents)} (${data.profile.toLowerCase()})`,
      metadata: { reason: "ROOT", profile: data.profile, capCents },
    });
    tx.update(branches).set({ birthEventId }).where(eq(branches.id, id)).run();
    return getBranchOrThrow(tx, id);
  });
}

export const setPausedSchema = z.object({
  branchId: z.string().min(1),
  paused: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/** Pause / resume a branch. A paused branch keeps its capital but cannot open rounds. */
export function setBranchPaused(
  db: Db,
  input: z.input<typeof setPausedSchema>,
  now = new Date(),
): BranchRow {
  const data = parseInput(setPausedSchema, input);
  return db.transaction((tx) => {
    const branch = getBranchOrThrow(tx, data.branchId);
    let nextStatus: BranchStatus;
    if (data.paused) {
      if (branch.status !== "ACTIVE" && branch.status !== "MATURE") {
        throw new DomainError("INVALID_STATE", `Cannot pause a ${branch.status} branch`);
      }
      if (hasPendingTicket(tx, branch.id)) {
        throw new DomainError(
          "PENDING_EXISTS",
          "Settle or cancel the pending ticket before pausing",
        );
      }
      nextStatus = "PAUSED";
    } else {
      if (branch.status !== "PAUSED") {
        throw new DomainError("INVALID_STATE", "Only paused branches can be resumed");
      }
      nextStatus = branch.maturedAt ? "MATURE" : "ACTIVE";
    }
    tx.update(branches)
      .set({ status: nextStatus, updatedAt: now })
      .where(eq(branches.id, branch.id))
      .run();
    insertEvent(tx, {
      branchId: branch.id,
      type: "STATUS_CHANGED",
      createdAt: now,
      capitalDeltaCents: 0,
      capitalAfterCents: branch.currentCapitalCents,
      statusAfter: nextStatus,
      description: `${branch.code} ${data.paused ? "paused" : "resumed"} (${branch.status} → ${nextStatus})${
        data.reason ? ` — ${data.reason}` : ""
      }`,
      metadata: { from: branch.status, to: nextStatus, reason: data.reason ?? null },
    });
    return getBranchOrThrow(tx, branch.id);
  });
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
  db: Db,
  input: z.input<typeof changeProfileSchema>,
  now = new Date(),
): BranchRow {
  const data = parseInput(changeProfileSchema, input);
  const settings = getSettings(db);
  const fmt = moneyFormatter(settings);
  return db.transaction((tx) => {
    const branch = getBranchOrThrow(tx, data.branchId);
    if (branch.status === "DEAD")
      throw new DomainError("INVALID_STATE", "Dead branches are frozen");
    if (branch.profile === data.profile) {
      throw new DomainError("VALIDATION", `${branch.code} already has the ${data.profile} profile`);
    }
    const capCents = data.applyProfileCap
      ? settings.profiles[data.profile].capCents
      : branch.capCents;
    if (capCents < branch.currentCapitalCents) {
      throw new DomainError("INVALID_STATE", "The new cap would be below the current capital");
    }
    tx.update(branches)
      .set({ profile: data.profile, capCents, updatedAt: now })
      .where(eq(branches.id, branch.id))
      .run();
    insertEvent(tx, {
      branchId: branch.id,
      type: "PROFILE_CHANGED",
      createdAt: now,
      capitalDeltaCents: 0,
      capitalAfterCents: branch.currentCapitalCents,
      statusAfter: branch.status,
      description: `Profile changed ${branch.profile} → ${data.profile}${
        capCents !== branch.capCents ? `, cap ${fmt(branch.capCents)} → ${fmt(capCents)}` : ""
      } — ${data.reason}`,
      metadata: {
        from: branch.profile,
        to: data.profile,
        previousCapCents: branch.capCents,
        capCents,
        reason: data.reason,
      },
    });
    return getBranchOrThrow(tx, branch.id);
  });
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
  db: Db,
  input: z.input<typeof adjustCapitalSchema>,
  now = new Date(),
): BranchRow {
  const data = parseInput(adjustCapitalSchema, input);
  const fmt = moneyFormatter(getSettings(db));
  return db.transaction((tx) => {
    const branch = getBranchOrThrow(tx, data.branchId);
    if (branch.status === "DEAD")
      throw new DomainError("INVALID_STATE", "Dead branches are frozen");
    if (hasPendingTicket(tx, branch.id)) {
      throw new DomainError("PENDING_EXISTS", "Settle or cancel the pending ticket first");
    }
    const next = branch.currentCapitalCents + data.deltaCents;
    if (next <= 0) throw new DomainError("VALIDATION", "Capital must stay above zero");
    if (next > branch.capCents) {
      throw new DomainError(
        "VALIDATION",
        `Capital cannot exceed the cap (${fmt(branch.capCents)})`,
      );
    }
    tx.update(branches)
      .set({
        currentCapitalCents: next,
        peakCapitalCents: Math.max(branch.peakCapitalCents, next),
        updatedAt: now,
      })
      .where(eq(branches.id, branch.id))
      .run();
    insertEvent(tx, {
      branchId: branch.id,
      type: "MANUAL_ADJUSTMENT",
      createdAt: now,
      amountCents: Math.abs(data.deltaCents),
      capitalDeltaCents: data.deltaCents,
      capitalAfterCents: next,
      statusAfter: branch.status,
      description: `Manual adjustment ${fmt(data.deltaCents, true)} — ${data.reason}`,
      metadata: { kind: "CAPITAL_CORRECTION", reason: data.reason },
    });
    return getBranchOrThrow(tx, branch.id);
  });
}

export const manualBankTransferSchema = z.object({
  branchId: z.string().min(1),
  amountCents: z.int().min(1),
  destination: z.enum(BANK_DESTINATIONS).default("UNALLOCATED"),
  reason: z.string().trim().min(3, { error: "A reason is required" }).max(500),
});

/** Manually secure part of a branch capital into the BANK (one-way, never reversible). */
export function transferToBank(
  db: Db,
  input: z.input<typeof manualBankTransferSchema>,
  now = new Date(),
): BranchRow {
  const data = parseInput(manualBankTransferSchema, input);
  const fmt = moneyFormatter(getSettings(db));
  return db.transaction((tx) => {
    const branch = getBranchOrThrow(tx, data.branchId);
    if (branch.status === "DEAD")
      throw new DomainError("INVALID_STATE", "Dead branches are frozen");
    if (hasPendingTicket(tx, branch.id)) {
      throw new DomainError("PENDING_EXISTS", "Settle or cancel the pending ticket first");
    }
    if (data.amountCents >= branch.currentCapitalCents) {
      throw new DomainError("VALIDATION", "Keep some capital in the branch (amount must be lower)");
    }
    const next = branch.currentCapitalCents - data.amountCents;
    tx.insert(bankTransactions)
      .values({
        id: newId(),
        branchId: branch.id,
        relatedBetId: null,
        amountCents: data.amountCents,
        createdAt: now,
        type: "MANUAL",
        harvestKind: null,
        profile: branch.profile,
        destination: data.destination,
        notes: data.reason,
      })
      .run();
    tx.update(branches)
      .set({
        currentCapitalCents: next,
        totalBankGeneratedCents: branch.totalBankGeneratedCents + data.amountCents,
        updatedAt: now,
      })
      .where(eq(branches.id, branch.id))
      .run();
    insertEvent(tx, {
      branchId: branch.id,
      type: "BANK_TRANSFER",
      createdAt: now,
      amountCents: data.amountCents,
      capitalDeltaCents: -data.amountCents,
      capitalAfterCents: next,
      statusAfter: branch.status,
      description: `Manual transfer ${fmt(data.amountCents, true)} secured to BANK — ${data.reason}`,
      metadata: { kind: "MANUAL", reason: data.reason },
    });
    return getBranchOrThrow(tx, branch.id);
  });
}

export const updateBranchNotesSchema = z.object({
  branchId: z.string().min(1),
  notes: z.string().trim().max(2_000),
});

export function updateBranchNotes(
  db: Db,
  input: z.input<typeof updateBranchNotesSchema>,
  now = new Date(),
) {
  const data = parseInput(updateBranchNotesSchema, input);
  getBranchOrThrow(db, data.branchId);
  db.update(branches)
    .set({ notes: data.notes || null, updatedAt: now })
    .where(eq(branches.id, data.branchId))
    .run();
}
