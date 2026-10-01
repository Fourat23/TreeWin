import { and, desc, eq, gt, gte, isNull, lt, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  createTicketSchema,
  eventKey,
  updateTicketDetailsSchema,
  type CreateTicketInput,
  type UpdateTicketDetailsInput,
} from "@/domain/bets/tickets";
import { calculateReturn, formatOdds } from "@/domain/money";
import {
  EngineError,
  evaluateSettlement,
  suggestedStakeCents,
  type SettlementPlan,
} from "@/domain/strategy/engine";
import type { StrategySettings } from "@/domain/strategy/settings";
import { isPlayable, PROFILES, SETTLE_RESULTS, type BirthReason } from "@/domain/types";
import type { Db, DbOrTx } from "../db/client";
import {
  bankTransactions,
  bets,
  branchEvents,
  branches,
  type BetRow,
  type BranchRow,
} from "../db/schema";
import { DomainError, notFound } from "./errors";
import {
  automaticProfileCounts,
  getBranchOrThrow,
  hasPendingTicket,
  insertEvent,
  moneyFormatter,
  newId,
  parseInput,
  toBranchState,
} from "./internal";
import { getSettings } from "./settings-service";

export function getBetOrThrow(tx: DbOrTx, betId: string): BetRow {
  const row = tx.select().from(bets).where(eq(bets.id, betId)).get();
  if (!row) throw notFound("Ticket", betId);
  return row;
}

/* -------------------------------------------------------------------------- */
/*                                 Protections                                */
/* -------------------------------------------------------------------------- */

export interface SameEventTicket {
  betId: string;
  branchId: string;
  branchCode: string;
  eventName: string;
  eventDate: string;
  selection: string;
}

export interface TicketConflicts {
  sameEvent: SameEventTicket[];
  pendingCount: number;
  todayCount: number;
  maxPendingTickets: number | null;
  maxTicketsPerDay: number | null;
  pendingLimitReached: boolean;
  dailyLimitReached: boolean;
}

export const conflictQuerySchema = z.object({
  eventName: z.string().trim().default(""),
  eventDate: z.string().trim().default(""),
  branchId: z.string().optional(),
  excludeBetId: z.string().optional(),
});

/** Live protections for a prospective ticket (same match on another branch, daily limits). */
export function checkTicketConflicts(
  db: DbOrTx,
  input: z.input<typeof conflictQuerySchema>,
  now = new Date(),
): TicketConflicts {
  const query = parseInput(conflictQuerySchema, input);
  const settings = getSettings(db);
  const sameEvent: SameEventTicket[] =
    query.eventName.length >= 3 && query.eventDate.length === 10
      ? db
          .select({
            betId: bets.id,
            branchId: bets.branchId,
            branchCode: branches.code,
            eventName: bets.eventName,
            eventDate: bets.eventDate,
            selection: bets.selection,
          })
          .from(bets)
          .innerJoin(branches, eq(bets.branchId, branches.id))
          .where(
            and(
              eq(bets.eventKey, eventKey(query.eventName, query.eventDate)),
              eq(bets.result, "PENDING"),
              isNull(bets.cancelledAt),
              query.branchId ? ne(bets.branchId, query.branchId) : undefined,
              query.excludeBetId ? ne(bets.id, query.excludeBetId) : undefined,
            ),
          )
          .all()
      : [];
  const pendingCount = Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(bets)
      .where(and(eq(bets.result, "PENDING"), isNull(bets.cancelledAt)))
      .get()?.n ?? 0,
  );
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const todayCount = Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(bets)
      .where(
        and(gte(bets.createdAt, dayStart), lt(bets.createdAt, dayEnd), isNull(bets.cancelledAt)),
      )
      .get()?.n ?? 0,
  );
  const { maxPendingTickets, maxTicketsPerDay } = settings.limits;
  return {
    sameEvent,
    pendingCount,
    todayCount,
    maxPendingTickets,
    maxTicketsPerDay,
    pendingLimitReached: maxPendingTickets !== null && pendingCount >= maxPendingTickets,
    dailyLimitReached: maxTicketsPerDay !== null && todayCount >= maxTicketsPerDay,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Creation                                  */
/* -------------------------------------------------------------------------- */

export interface CreateTicketResult {
  bet: BetRow;
  warnings: string[];
}

export function createTicket(
  db: Db,
  input: CreateTicketInput,
  now = new Date(),
): CreateTicketResult {
  const data = parseInput(createTicketSchema, input);
  const settings = getSettings(db);
  const fmt = moneyFormatter(settings);

  return db.transaction((tx) => {
    const branch = getBranchOrThrow(tx, data.branchId);
    if (!isPlayable(branch.status)) {
      throw new DomainError(
        "INVALID_STATE",
        `${branch.code} is ${branch.status}: no new round can be opened`,
      );
    }
    if (hasPendingTicket(tx, branch.id)) {
      throw new DomainError("PENDING_EXISTS", `${branch.code} already has a pending ticket`);
    }
    if (data.stakeCents > branch.currentCapitalCents) {
      throw new DomainError(
        "VALIDATION",
        `Stake exceeds ${branch.code} capital (${fmt(branch.currentCapitalCents)})`,
      );
    }

    const conflicts = checkTicketConflicts(
      tx,
      { eventName: data.eventName, eventDate: data.eventDate, branchId: branch.id },
      now,
    );
    const blocking: { code: "SAME_EVENT_CONFLICT" | "LIMIT_REACHED"; message: string }[] = [];
    if (conflicts.sameEvent.length > 0 && settings.sameEventPolicy === "BLOCK") {
      blocking.push({
        code: "SAME_EVENT_CONFLICT",
        message: `Same match already pending on ${conflicts.sameEvent
          .map((c) => c.branchCode)
          .join(", ")}. Correlated branches are blocked by default.`,
      });
    }
    if (conflicts.pendingLimitReached) {
      blocking.push({
        code: "LIMIT_REACHED",
        message: `Maximum of ${conflicts.maxPendingTickets} concurrent pending tickets reached`,
      });
    }
    if (conflicts.dailyLimitReached) {
      blocking.push({
        code: "LIMIT_REACHED",
        message: `Maximum of ${conflicts.maxTicketsPerDay} tickets per day reached`,
      });
    }
    const [firstBlocking] = blocking;
    if (firstBlocking && !data.override) {
      throw new DomainError(firstBlocking.code, firstBlocking.message, {
        conflicts,
        reasons: blocking.map((b) => b.message),
      });
    }

    const warnings: string[] = [];
    if (conflicts.sameEvent.length > 0 && settings.sameEventPolicy === "WARN") {
      warnings.push("Same match already pending on another branch");
    }
    if (data.oddsBp < settings.odds.minBp || data.oddsBp > settings.odds.maxBp) {
      warnings.push(
        `Odds ${formatOdds(data.oddsBp)} outside the configured range ${formatOdds(
          settings.odds.minBp,
        )}–${formatOdds(settings.odds.maxBp)}`,
      );
    }
    const suggested = suggestedStakeCents(branch);
    if (data.stakeCents < suggested) {
      warnings.push(`Stake below the suggested ${fmt(suggested)}`);
    }

    const sequenceRow = tx
      .select({ value: max(bets.sequence) })
      .from(bets)
      .where(eq(bets.branchId, branch.id))
      .get();
    const sequence = (sequenceRow?.value ?? 0) + 1;
    const roundNumber = branch.roundCount + 1;
    const potentialReturnCents = calculateReturn(data.stakeCents, data.oddsBp);
    const id = newId();
    const overrideReason = blocking.length > 0 && data.override ? data.override.reason : null;

    tx.insert(bets)
      .values({
        id,
        branchId: branch.id,
        sequence,
        roundNumber,
        createdAt: now,
        updatedAt: now,
        eventDate: data.eventDate,
        eventTime: data.eventTime ?? null,
        sport: data.sport,
        competition: data.competition,
        eventName: data.eventName,
        eventKey: eventKey(data.eventName, data.eventDate),
        homeTeam: data.homeTeam ?? null,
        awayTeam: data.awayTeam ?? null,
        marketName: data.marketName,
        selection: data.selection,
        oddsBp: data.oddsBp,
        stakeCents: data.stakeCents,
        potentialReturnCents,
        result: "PENDING",
        capitalBeforeCents: branch.currentCapitalCents,
        closingOddsBp: data.closingOddsBp ?? null,
        notes: data.notes ?? null,
        protocolStatus: data.protocolStatus ?? null,
        confidence: data.confidence ?? null,
        checklist: data.checklist,
        overrideReason,
      })
      .run();

    insertEvent(tx, {
      branchId: branch.id,
      type: "BET_CREATED",
      createdAt: now,
      amountCents: data.stakeCents,
      capitalDeltaCents: 0,
      capitalAfterCents: branch.currentCapitalCents,
      statusAfter: branch.status,
      relatedBetId: id,
      description: `${settings.roundShortLabel}${roundNumber} opened — ${data.eventName} · ${
        data.selection
      } @${formatOdds(data.oddsBp)} · stake ${fmt(data.stakeCents)}`,
      metadata: {
        eventName: data.eventName,
        selection: data.selection,
        oddsBp: data.oddsBp,
        stakeCents: data.stakeCents,
        potentialReturnCents,
        overrideReason,
        warnings,
      },
    });
    tx.update(branches).set({ updatedAt: now }).where(eq(branches.id, branch.id)).run();
    return { bet: getBetOrThrow(tx, id), warnings };
  });
}

/* -------------------------------------------------------------------------- */
/*                                 Settlement                                 */
/* -------------------------------------------------------------------------- */

export const settleTicketSchema = z.object({
  betId: z.string().min(1),
  result: z.enum(SETTLE_RESULTS),
  /** Optional explicit profiles for the children this settlement creates, in order. */
  childProfiles: z.array(z.enum(PROFILES).nullable()).max(32).optional(),
});
export type SettleTicketInput = z.input<typeof settleTicketSchema>;

export interface SettlementPreview {
  bet: BetRow;
  branch: BranchRow;
  plan: SettlementPlan;
}

function planFor(
  tx: DbOrTx,
  input: z.output<typeof settleTicketSchema>,
  settings: StrategySettings,
) {
  const bet = getBetOrThrow(tx, input.betId);
  if (bet.result !== "PENDING" || bet.cancelledAt) {
    throw new DomainError("INVALID_STATE", "Only pending tickets can be settled");
  }
  const branch = getBranchOrThrow(tx, bet.branchId);
  try {
    const plan = evaluateSettlement(
      toBranchState(branch),
      { roundNumber: bet.roundNumber, stakeCents: bet.stakeCents, oddsBp: bet.oddsBp },
      input.result,
      settings,
      { profileCounts: automaticProfileCounts(tx), childProfileOverrides: input.childProfiles },
    );
    return { bet, branch, plan };
  } catch (error) {
    if (error instanceof EngineError) throw new DomainError("INVALID_STATE", error.message);
    throw error;
  }
}

/** Dry-run of a settlement: what would happen, without writing anything. */
export function previewSettlement(db: DbOrTx, input: SettleTicketInput): SettlementPreview {
  const data = parseInput(settleTicketSchema, input);
  return planFor(db, data, getSettings(db));
}

export interface SettlementOutcome extends SettlementPreview {
  childIds: string[];
  bankTransactionIds: string[];
}

/**
 * Settle a ticket and apply every consequence (BANK transfers, children, maturity, death)
 * atomically: either the whole plan is persisted or nothing is.
 */
export function settleTicket(
  db: Db,
  input: SettleTicketInput,
  now = new Date(),
): SettlementOutcome {
  const data = parseInput(settleTicketSchema, input);
  const settings = getSettings(db);
  const fmt = moneyFormatter(settings);

  return db.transaction((tx) => {
    const { bet, branch, plan } = planFor(tx, data, settings);

    tx.update(bets)
      .set({
        result: plan.result,
        settledAt: now,
        updatedAt: now,
        actualReturnCents: plan.actualReturnCents,
        profitLossCents: plan.profitLossCents,
        capitalAfterCents: plan.capitalAfterBetCents,
        countsAsRound: plan.countsAsRound,
      })
      .where(eq(bets.id, bet.id))
      .run();

    // 1. Children rows first (events reference them).
    const childIds = plan.children.map((child) => {
      const id = newId();
      const capCents = Math.max(settings.profiles[child.profile].capCents, child.capitalCents);
      tx.insert(branches)
        .values({
          id,
          code: child.code,
          parentId: branch.id,
          generation: branch.generation + 1,
          profile: child.profile,
          status: "ACTIVE",
          birthReason: child.reason satisfies BirthReason,
          birthBetId: bet.id,
          birthCapitalCents: child.capitalCents,
          currentCapitalCents: child.capitalCents,
          capCents,
          peakCapitalCents: child.capitalCents,
          p1Done: !settings.p1.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return id;
    });

    // 2. BANK transactions — money only flows in, never back to the branches.
    const bankTransactionIds = plan.bankTransfers.map((transfer) => {
      const id = newId();
      tx.insert(bankTransactions)
        .values({
          id,
          branchId: branch.id,
          relatedBetId: bet.id,
          amountCents: transfer.amountCents,
          createdAt: now,
          type: transfer.type,
          harvestKind: transfer.harvestKind,
          profile: branch.profile,
          destination: "UNALLOCATED",
          notes: null,
        })
        .run();
      return id;
    });

    // 3. Event log, in plan order; each child's BIRTH right after its CHILD_CREATED.
    for (const event of plan.events) {
      const childId = event.childIndex !== undefined ? childIds[event.childIndex] : undefined;
      const bankIndex = event.metadata.bankTransferIndex;
      const metadata =
        typeof bankIndex === "number"
          ? { ...event.metadata, bankTransactionId: bankTransactionIds[bankIndex] }
          : event.metadata;
      insertEvent(tx, {
        branchId: branch.id,
        type: event.type,
        createdAt: now,
        amountCents: event.amountCents,
        capitalDeltaCents: event.capitalDeltaCents,
        capitalAfterCents: event.capitalAfterCents,
        statusAfter: event.statusAfter,
        relatedBetId: bet.id,
        relatedBranchId: childId ?? null,
        metadata,
        description: event.description,
      });
      if (event.type === "CHILD_CREATED" && childId && event.childIndex !== undefined) {
        const child = plan.children[event.childIndex];
        if (!child) continue;
        const birthEventId = insertEvent(tx, {
          branchId: childId,
          type: "BIRTH",
          createdAt: now,
          amountCents: child.capitalCents,
          capitalDeltaCents: child.capitalCents,
          capitalAfterCents: child.capitalCents,
          statusAfter: "ACTIVE",
          relatedBetId: bet.id,
          relatedBranchId: branch.id,
          description: `Born from ${branch.code} (${child.reason}) in ${settings.roundShortLabel}${
            bet.roundNumber
          } with ${fmt(child.capitalCents)} — ${child.profile.toLowerCase()}`,
          metadata: {
            reason: child.reason,
            parentCode: branch.code,
            profile: child.profile,
            roundNumber: bet.roundNumber,
          },
        });
        tx.update(branches).set({ birthEventId }).where(eq(branches.id, childId)).run();
      }
    }

    // 4. Mother branch.
    tx.update(branches)
      .set({
        currentCapitalCents: plan.finalCapitalCents,
        status: plan.status,
        p1Done: plan.p1Done,
        thresholdLevel: plan.thresholdLevel,
        wins: plan.wins,
        losses: plan.losses,
        voids: plan.voids,
        roundCount: plan.roundCount,
        childCount: branch.childCount + plan.children.length,
        totalBankGeneratedCents: branch.totalBankGeneratedCents + plan.totalBankCents,
        totalChildCapitalGeneratedCents:
          branch.totalChildCapitalGeneratedCents + plan.totalChildCapitalCents,
        totalLostCents: branch.totalLostCents + plan.lostCents,
        peakCapitalCents: Math.max(branch.peakCapitalCents, plan.capitalAfterBetCents),
        maturedAt: plan.matured ? now : branch.maturedAt,
        diedAt: plan.died ? now : branch.diedAt,
        lastRoundAt: now,
        updatedAt: now,
      })
      .where(eq(branches.id, branch.id))
      .run();

    return {
      bet: getBetOrThrow(tx, bet.id),
      branch: getBranchOrThrow(tx, branch.id),
      plan,
      childIds,
      bankTransactionIds,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                         Cancellation, edits, revert                        */
/* -------------------------------------------------------------------------- */

export const cancelTicketSchema = z.object({
  betId: z.string().min(1),
  reason: z.string().trim().min(3, { error: "A reason is required" }).max(500),
});

/** Cancel a pending ticket entered by mistake (soft delete, journaled). */
export function cancelPendingTicket(
  db: Db,
  input: z.input<typeof cancelTicketSchema>,
  now = new Date(),
) {
  const data = parseInput(cancelTicketSchema, input);
  const settings = getSettings(db);
  return db.transaction((tx) => {
    const bet = getBetOrThrow(tx, data.betId);
    if (bet.result !== "PENDING" || bet.cancelledAt) {
      throw new DomainError("INVALID_STATE", "Only pending tickets can be cancelled");
    }
    const branch = getBranchOrThrow(tx, bet.branchId);
    tx.update(bets)
      .set({ cancelledAt: now, cancelReason: data.reason, updatedAt: now })
      .where(eq(bets.id, bet.id))
      .run();
    insertEvent(tx, {
      branchId: branch.id,
      type: "BET_CANCELLED",
      createdAt: now,
      amountCents: bet.stakeCents,
      capitalDeltaCents: 0,
      capitalAfterCents: branch.currentCapitalCents,
      statusAfter: branch.status,
      relatedBetId: bet.id,
      description: `${settings.roundShortLabel}${bet.roundNumber} ticket cancelled before settlement — ${data.reason}`,
      metadata: { reason: data.reason },
    });
    return getBetOrThrow(tx, bet.id);
  });
}

const FINANCIAL_SAFE_FIELDS = new Set(["closingOddsBp", "notes", "protocolStatus", "confidence"]);

/**
 * Edit descriptive fields of a ticket. Stake, odds and result are never editable here:
 * money corrections go through settlement revert or explicit manual adjustments.
 * Edits of a settled ticket's identity are journaled as MANUAL_ADJUSTMENT (no capital effect).
 */
export function updateTicketDetails(
  db: Db,
  input: UpdateTicketDetailsInput & { override?: { confirmed: true; reason: string } },
  now = new Date(),
): BetRow {
  const { betId, ...changes } = parseInput(updateTicketDetailsSchema, input);
  return db.transaction((tx) => {
    const bet = getBetOrThrow(tx, betId);
    const patch: Partial<BetRow> = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, value] of Object.entries(changes) as [keyof typeof changes, unknown][]) {
      if (value === undefined) continue;
      const current = bet[key as keyof BetRow];
      if (current === value) continue;
      changed[key] = { from: current, to: value };
      (patch as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(changed).length === 0) return bet;

    const identityChanged = "eventName" in changed || "eventDate" in changed;
    if (identityChanged) {
      const eventName = (patch.eventName ?? bet.eventName) as string;
      const eventDate = (patch.eventDate ?? bet.eventDate) as string;
      patch.eventKey = eventKey(eventName, eventDate);
      if (bet.result === "PENDING" && !bet.cancelledAt) {
        const conflicts = checkTicketConflicts(tx, {
          eventName,
          eventDate,
          branchId: bet.branchId,
          excludeBetId: bet.id,
        });
        if (
          conflicts.sameEvent.length > 0 &&
          getSettings(tx).sameEventPolicy === "BLOCK" &&
          !input.override
        ) {
          throw new DomainError(
            "SAME_EVENT_CONFLICT",
            "Same match already pending on another branch",
            {
              conflicts,
            },
          );
        }
      }
    }
    tx.update(bets)
      .set({ ...patch, updatedAt: now })
      .where(eq(bets.id, bet.id))
      .run();

    const journaled = Object.keys(changed).filter((k) => !FINANCIAL_SAFE_FIELDS.has(k));
    if (bet.result !== "PENDING" && journaled.length > 0) {
      const branch = getBranchOrThrow(tx, bet.branchId);
      insertEvent(tx, {
        branchId: branch.id,
        type: "MANUAL_ADJUSTMENT",
        createdAt: now,
        capitalDeltaCents: 0,
        capitalAfterCents: branch.currentCapitalCents,
        statusAfter: branch.status,
        relatedBetId: bet.id,
        description: `Settled ticket ${getSettings(tx).roundShortLabel}${bet.roundNumber} edited (${journaled.join(", ")})`,
        metadata: { kind: "TICKET_EDIT", changes: changed },
      });
    }
    return getBetOrThrow(tx, bet.id);
  });
}

export const revertSettlementSchema = z.object({
  betId: z.string().min(1),
  reason: z.string().trim().min(3, { error: "A reason is required" }).max(500),
});

export interface RevertCheck {
  revertible: boolean;
  reason: string | null;
}

/**
 * A settlement can be reverted (to fix a wrong result) only when it had no side effects
 * beyond the branch itself: it must be the branch's latest ticket, and must not have
 * created children, BANK transfers or maturity. Otherwise use a manual adjustment.
 */
export function checkRevertible(db: DbOrTx, betId: string): RevertCheck {
  const bet = getBetOrThrow(db, betId);
  if (bet.result === "PENDING" || bet.cancelledAt) {
    return { revertible: false, reason: "Ticket is not settled" };
  }
  const later = db
    .select({ id: bets.id })
    .from(bets)
    .where(
      and(
        eq(bets.branchId, bet.branchId),
        gte(bets.sequence, bet.sequence + 1),
        isNull(bets.cancelledAt),
      ),
    )
    .get();
  if (later) return { revertible: false, reason: "A later ticket exists on this branch" };
  const children = db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.birthBetId, bet.id))
    .get();
  if (children) return { revertible: false, reason: "This settlement created child branches" };
  const bank = db
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(eq(bankTransactions.relatedBetId, bet.id))
    .get();
  if (bank) return { revertible: false, reason: "This settlement sent money to the BANK" };
  const matured = db
    .select({ id: branchEvents.id })
    .from(branchEvents)
    .where(and(eq(branchEvents.relatedBetId, bet.id), eq(branchEvents.type, "CAP_REACHED")))
    .get();
  if (matured) return { revertible: false, reason: "This settlement made the branch mature" };
  const lastSettlementEvent = db
    .select({ id: max(branchEvents.id) })
    .from(branchEvents)
    .where(and(eq(branchEvents.branchId, bet.branchId), eq(branchEvents.relatedBetId, bet.id)))
    .get();
  const laterEvent = db
    .select({ id: branchEvents.id })
    .from(branchEvents)
    .where(
      and(
        eq(branchEvents.branchId, bet.branchId),
        gt(branchEvents.id, lastSettlementEvent?.id ?? Number.MAX_SAFE_INTEGER),
      ),
    )
    .get();
  if (laterEvent) return { revertible: false, reason: "The branch changed after this settlement" };
  return { revertible: true, reason: null };
}

/** Put a wrongly settled ticket back to PENDING and restore the branch exactly. */
export function revertSettlement(
  db: Db,
  input: z.input<typeof revertSettlementSchema>,
  now = new Date(),
) {
  const data = parseInput(revertSettlementSchema, input);
  const settings = getSettings(db);
  const fmt = moneyFormatter(settings);
  return db.transaction((tx) => {
    const check = checkRevertible(tx, data.betId);
    if (!check.revertible)
      throw new DomainError("NOT_REVERTIBLE", check.reason ?? "Not revertible");
    const bet = getBetOrThrow(tx, data.betId);
    const branch = getBranchOrThrow(tx, bet.branchId);
    const previous = bet.result;
    const restoredCapital = bet.capitalBeforeCents;
    const delta = restoredCapital - branch.currentCapitalCents;
    const restoredStatus =
      previous === "LOST" && branch.status === "DEAD"
        ? branch.maturedAt
          ? "MATURE"
          : "ACTIVE"
        : branch.status;

    const peak = tx
      .select({ value: max(bets.capitalAfterCents) })
      .from(bets)
      .where(and(eq(bets.branchId, branch.id), ne(bets.id, bet.id)))
      .get();
    const previousSettled = tx
      .select({ settledAt: bets.settledAt })
      .from(bets)
      .where(and(eq(bets.branchId, branch.id), ne(bets.id, bet.id), isNull(bets.cancelledAt)))
      .orderBy(desc(bets.sequence))
      .get();

    tx.update(bets)
      .set({
        result: "PENDING",
        settledAt: null,
        actualReturnCents: null,
        profitLossCents: null,
        capitalAfterCents: null,
        countsAsRound: null,
        updatedAt: now,
      })
      .where(eq(bets.id, bet.id))
      .run();
    tx.update(branches)
      .set({
        currentCapitalCents: restoredCapital,
        status: restoredStatus,
        wins: branch.wins - (previous === "WON" ? 1 : 0),
        losses: branch.losses - (previous === "LOST" ? 1 : 0),
        voids: branch.voids - (previous === "VOID" ? 1 : 0),
        roundCount: branch.roundCount - (bet.countsAsRound ? 1 : 0),
        totalLostCents: branch.totalLostCents - (previous === "LOST" ? bet.stakeCents : 0),
        peakCapitalCents: Math.max(branch.birthCapitalCents, peak?.value ?? 0, restoredCapital),
        diedAt: restoredStatus === "DEAD" ? branch.diedAt : null,
        lastRoundAt: previousSettled?.settledAt ?? null,
        updatedAt: now,
      })
      .where(eq(branches.id, branch.id))
      .run();
    insertEvent(tx, {
      branchId: branch.id,
      type: "MANUAL_ADJUSTMENT",
      createdAt: now,
      amountCents: Math.abs(delta),
      capitalDeltaCents: delta,
      capitalAfterCents: restoredCapital,
      statusAfter: restoredStatus,
      relatedBetId: bet.id,
      description: `Settlement of ${settings.roundShortLabel}${bet.roundNumber} reverted (${previous} → PENDING), capital ${fmt(
        delta,
        true,
      )} — ${data.reason}`,
      metadata: { kind: "SETTLEMENT_REVERTED", previousResult: previous, reason: data.reason },
    });
    return getBetOrThrow(tx, bet.id);
  });
}
