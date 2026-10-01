import { z } from "zod";
import { evaluateTicketPolicy, ticketRulesFor, type PolicyViolation } from "@/domain/bets/policy";
import {
  createTicketSchema,
  eventKey,
  updateTicketDetailsSchema,
  type CreateTicketInput,
  type UpdateTicketDetailsInput,
} from "@/domain/bets/tickets";
import { calculateReturn, formatOdds } from "@/domain/money";
import { EngineError, evaluateSettlement, type SettlementPlan } from "@/domain/strategy/engine";
import { isPlayable, PROFILES, SETTLE_RESULTS } from "@/domain/types";
import type { BetRecord, BranchRecord, WorkspaceState } from "../state/schema";
import { DomainError } from "./errors";
import {
  automaticProfileCounts,
  getBetOrThrow,
  getBranchOrThrow,
  isOpenTicket,
  localDay,
  moneyFormatter,
  newId,
  parseInput,
  pendingTicketOf,
  pushEvent,
  strategyStamp,
  type OpContext,
} from "./internal";

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

/** Live protections for a prospective ticket (same match on another branch, limits). */
export function checkTicketConflicts(
  state: WorkspaceState,
  input: z.input<typeof conflictQuerySchema>,
  now: Date,
): TicketConflicts {
  const query = parseInput(conflictQuerySchema, input);
  const codes = new Map(state.branches.map((b) => [b.id, b.code]));
  const key =
    query.eventName.length >= 3 && query.eventDate.length === 10
      ? eventKey(query.eventName, query.eventDate)
      : null;
  const sameEvent = key
    ? state.bets
        .filter(
          (b) =>
            isOpenTicket(b) &&
            b.eventKey === key &&
            b.branchId !== query.branchId &&
            b.id !== query.excludeBetId,
        )
        .map((b) => ({
          betId: b.id,
          branchId: b.branchId,
          branchCode: codes.get(b.branchId) ?? "?",
          eventName: b.eventName,
          eventDate: b.eventDate,
          selection: b.selection,
        }))
    : [];
  const today = localDay(now);
  const pendingCount = state.bets.filter(isOpenTicket).length;
  const todayCount = state.bets.filter(
    (b) => b.cancelledAt === null && localDay(new Date(b.createdAt)) === today,
  ).length;
  const { maxPendingTickets, maxTicketsPerDay } = state.settings.limits;
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
  bet: BetRecord;
  warnings: string[];
}

function policyError(violations: PolicyViolation[]): DomainError {
  return new DomainError("POLICY_VIOLATION", violations[0]?.message ?? "Ticket refused", {
    violations,
  });
}

export function createTicket(
  state: WorkspaceState,
  input: CreateTicketInput,
  ctx: OpContext,
): CreateTicketResult {
  const data = parseInput(createTicketSchema, input);
  const settings = state.settings;
  const fmt = moneyFormatter(settings);
  const branch = getBranchOrThrow(state, data.branchId);
  if (!isPlayable(branch.status)) {
    throw new DomainError(
      "INVALID_STATE",
      `${branch.code} is ${branch.status}: no new round can be opened`,
    );
  }
  if (pendingTicketOf(state, branch.id)) {
    throw new DomainError("PENDING_EXISTS", `${branch.code} already has a pending ticket`);
  }

  const conflicts = checkTicketConflicts(
    state,
    { eventName: data.eventName, eventDate: data.eventDate, branchId: branch.id },
    ctx.now,
  );
  const policy = evaluateTicketPolicy({
    workspace: ctx.workspace,
    rules: ticketRulesFor(settings, branch.profile),
    branch,
    stakeCents: data.stakeCents,
    oddsBp: data.oddsBp,
    sameEventBranchCodes: conflicts.sameEvent.map((c) => c.branchCode),
    pendingLimitReached: conflicts.pendingLimitReached,
    dailyLimitReached: conflicts.dailyLimitReached,
  });
  // A violation passes only if it is overridable in this workspace AND explicitly overridden.
  const blocking = policy.violations.filter((v) => !v.overridable || !data.override);
  if (blocking.length > 0) throw policyError(policy.violations);
  const overrideReason =
    policy.violations.length > 0 && data.override ? data.override.reason : null;
  const outsideV1 = policy.violations.some(
    (v) => v.code === "STAKE_NOT_FULL" || v.code === "ODDS_ABOVE_MAX" || v.code === "SAME_EVENT",
  );

  const sequence =
    Math.max(0, ...state.bets.filter((b) => b.branchId === branch.id).map((b) => b.sequence)) + 1;
  const roundNumber = branch.roundCount + 1;
  const potentialReturnCents = calculateReturn(data.stakeCents, data.oddsBp);
  const now = ctx.now.getTime();
  const bet: BetRecord = {
    id: newId(),
    branchId: branch.id,
    sequence,
    roundNumber,
    createdAt: now,
    updatedAt: now,
    settledAt: null,
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
    bookmaker: "WINAMAX",
    oddsBp: data.oddsBp,
    stakeCents: data.stakeCents,
    potentialReturnCents,
    result: "PENDING",
    actualReturnCents: null,
    profitLossCents: null,
    capitalBeforeCents: branch.currentCapitalCents,
    capitalAfterCents: null,
    countsAsRound: null,
    closingOddsBp: data.closingOddsBp ?? null,
    notes: data.notes ?? null,
    protocolStatus: data.protocolStatus ?? null,
    confidence: data.confidence ?? null,
    checklist: data.checklist,
    screenshotPath: null,
    overrideReason,
    outsideV1,
    cancelledAt: null,
    cancelReason: null,
    ...strategyStamp(state),
  };
  state.bets.push(bet);
  pushEvent(state, {
    branchId: branch.id,
    type: "BET_CREATED",
    createdAt: now,
    amountCents: data.stakeCents,
    capitalDeltaCents: 0,
    capitalAfterCents: branch.currentCapitalCents,
    statusAfter: branch.status,
    relatedBetId: bet.id,
    relatedBranchId: null,
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
      overridden: overrideReason ? policy.violations.map((v) => v.code) : [],
      warnings: policy.warnings,
    },
  });
  branch.updatedAt = now;
  return { bet, warnings: policy.warnings };
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
  bet: BetRecord;
  branch: BranchRecord;
  plan: SettlementPlan;
}

/** Dry-run of a settlement: what would happen, without changing anything. */
export function previewSettlement(
  state: WorkspaceState,
  input: SettleTicketInput,
): SettlementPreview {
  const data = parseInput(settleTicketSchema, input);
  const bet = getBetOrThrow(state, data.betId);
  if (!isOpenTicket(bet))
    throw new DomainError("INVALID_STATE", "Only pending tickets can be settled");
  const branch = getBranchOrThrow(state, bet.branchId);
  try {
    const plan = evaluateSettlement(
      {
        code: branch.code,
        profile: branch.profile,
        status: branch.status,
        birthCapitalCents: branch.birthCapitalCents,
        currentCapitalCents: branch.currentCapitalCents,
        capCents: branch.capCents,
        p1Done: branch.p1Done,
        thresholdLevel: branch.thresholdLevel,
        wins: branch.wins,
        losses: branch.losses,
        voids: branch.voids,
        roundCount: branch.roundCount,
        childCount: branch.childCount,
      },
      { roundNumber: bet.roundNumber, stakeCents: bet.stakeCents, oddsBp: bet.oddsBp },
      data.result,
      state.settings,
      { profileCounts: automaticProfileCounts(state), childProfileOverrides: data.childProfiles },
    );
    return { bet, branch, plan };
  } catch (error) {
    if (error instanceof EngineError) throw new DomainError("INVALID_STATE", error.message);
    throw error;
  }
}

export interface SettlementOutcome extends SettlementPreview {
  childIds: string[];
  bankTransactionIds: string[];
}

/**
 * Settle a ticket and apply every consequence (BANK transfers, children, maturity, death) on
 * the draft. The repository persists the draft atomically — all or nothing.
 */
export function settleTicket(
  state: WorkspaceState,
  input: SettleTicketInput,
  ctx: OpContext,
): SettlementOutcome {
  const { bet, branch, plan } = previewSettlement(state, input);
  const settings = state.settings;
  const fmt = moneyFormatter(settings);
  const now = ctx.now.getTime();
  const stamp = strategyStamp(state);

  Object.assign(bet, {
    result: plan.result,
    settledAt: now,
    updatedAt: now,
    actualReturnCents: plan.actualReturnCents,
    profitLossCents: plan.profitLossCents,
    capitalAfterCents: plan.capitalAfterBetCents,
    countsAsRound: plan.countsAsRound,
  });

  // 1. Children first (events reference them).
  const children = plan.children.map((child) => {
    const record: BranchRecord = {
      id: newId(),
      code: child.code,
      parentId: branch.id,
      generation: branch.generation + 1,
      profile: child.profile,
      status: "ACTIVE",
      birthReason: child.reason,
      birthBetId: bet.id,
      birthEventId: null,
      birthCapitalCents: child.capitalCents,
      currentCapitalCents: child.capitalCents,
      capCents: Math.max(settings.profiles[child.profile].capCents, child.capitalCents),
      peakCapitalCents: child.capitalCents,
      p1Done: !settings.p1.enabled,
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
      notes: null,
      ...stamp,
    };
    state.branches.push(record);
    return record;
  });

  // 2. BANK transactions — money only flows in, never back to the branches.
  const bankTransactionIds = plan.bankTransfers.map((transfer) => {
    const id = newId();
    state.bankTransactions.push({
      id,
      branchId: branch.id,
      relatedBetId: bet.id,
      amountCents: transfer.amountCents,
      createdAt: now,
      type: transfer.type,
      harvestKind: transfer.harvestKind,
      profile: branch.profile,
      status: "SECURED",
      withdrawnAt: null,
      destination: "UNALLOCATED",
      notes: null,
    });
    return id;
  });

  // 3. Event log, in plan order; each child's BIRTH right after its CHILD_CREATED.
  for (const event of plan.events) {
    const child = event.childIndex !== undefined ? children[event.childIndex] : undefined;
    const bankIndex = event.metadata.bankTransferIndex;
    const metadata =
      typeof bankIndex === "number"
        ? { ...event.metadata, bankTransactionId: bankTransactionIds[bankIndex] }
        : event.metadata;
    pushEvent(state, {
      branchId: branch.id,
      type: event.type,
      createdAt: now,
      amountCents: event.amountCents,
      capitalDeltaCents: event.capitalDeltaCents,
      capitalAfterCents: event.capitalAfterCents,
      statusAfter: event.statusAfter,
      relatedBetId: bet.id,
      relatedBranchId: child?.id ?? null,
      metadata,
      description: event.description,
    });
    if (event.type === "CHILD_CREATED" && child) {
      child.birthEventId = pushEvent(state, {
        branchId: child.id,
        type: "BIRTH",
        createdAt: now,
        amountCents: child.birthCapitalCents,
        capitalDeltaCents: child.birthCapitalCents,
        capitalAfterCents: child.birthCapitalCents,
        statusAfter: "ACTIVE",
        relatedBetId: bet.id,
        relatedBranchId: branch.id,
        description: `Born from ${branch.code} (${child.birthReason}) in ${settings.roundShortLabel}${
          bet.roundNumber
        } with ${fmt(child.birthCapitalCents)} — ${child.profile.toLowerCase()}`,
        metadata: {
          reason: child.birthReason,
          parentCode: branch.code,
          profile: child.profile,
          capCents: child.capCents,
          p1Done: child.p1Done,
          roundNumber: bet.roundNumber,
        },
      });
    }
  }

  // 4. Mother branch.
  Object.assign(branch, {
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
  });

  return { bet, branch, plan, childIds: children.map((c) => c.id), bankTransactionIds };
}

/* -------------------------------------------------------------------------- */
/*                            Cancellation & edits                            */
/* -------------------------------------------------------------------------- */

export const cancelTicketSchema = z.object({
  betId: z.string().min(1),
  reason: z.string().trim().min(3, { error: "A reason is required" }).max(500),
});

/** Cancel a pending ticket entered by mistake (soft delete: it stays in the journal). */
export function cancelPendingTicket(
  state: WorkspaceState,
  input: z.input<typeof cancelTicketSchema>,
  ctx: OpContext,
): BetRecord {
  const data = parseInput(cancelTicketSchema, input);
  const bet = getBetOrThrow(state, data.betId);
  if (!isOpenTicket(bet))
    throw new DomainError("INVALID_STATE", "Only pending tickets can be cancelled");
  const branch = getBranchOrThrow(state, bet.branchId);
  const now = ctx.now.getTime();
  bet.cancelledAt = now;
  bet.cancelReason = data.reason;
  bet.updatedAt = now;
  pushEvent(state, {
    branchId: branch.id,
    type: "BET_CANCELLED",
    createdAt: now,
    amountCents: bet.stakeCents,
    capitalDeltaCents: 0,
    capitalAfterCents: branch.currentCapitalCents,
    statusAfter: branch.status,
    relatedBetId: bet.id,
    relatedBranchId: null,
    description: `${state.settings.roundShortLabel}${bet.roundNumber} ticket cancelled before settlement — ${data.reason}`,
    metadata: { reason: data.reason },
  });
  return bet;
}

/** Descriptive fields whose edit is not journaled (post-match annotations). */
const ANNOTATION_FIELDS = new Set(["closingOddsBp", "notes", "protocolStatus", "confidence"]);

/**
 * Edit descriptive fields of a ticket. Stake, odds and result are never editable here: money
 * corrections go through the correction workflow (reopen / delete from this point).
 * Identity edits of a settled ticket are journaled as MANUAL_ADJUSTMENT (no capital effect).
 */
export function updateTicketDetails(
  state: WorkspaceState,
  input: UpdateTicketDetailsInput & { override?: { confirmed: true; reason: string } },
  ctx: OpContext,
): BetRecord {
  const { betId, ...changes } = parseInput(updateTicketDetailsSchema, input);
  const bet = getBetOrThrow(state, betId);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(changes) as [keyof BetRecord, unknown][]) {
    if (value === undefined || bet[key] === value) continue;
    changed[key] = { from: bet[key], to: value };
  }
  if (Object.keys(changed).length === 0) return bet;

  const eventName = (changes.eventName ?? bet.eventName) as string;
  const eventDate = (changes.eventDate ?? bet.eventDate) as string;
  if (("eventName" in changed || "eventDate" in changed) && isOpenTicket(bet)) {
    const conflicts = checkTicketConflicts(
      state,
      { eventName, eventDate, branchId: bet.branchId, excludeBetId: bet.id },
      ctx.now,
    );
    if (conflicts.sameEvent.length > 0 && state.settings.sameEventPolicy === "BLOCK") {
      const allowed = ctx.workspace === "DEMO" && input.override;
      if (!allowed) {
        throw policyError([
          {
            code: "SAME_EVENT",
            message: `Same match already pending on ${conflicts.sameEvent.map((c) => c.branchCode).join(", ")}`,
            overridable: ctx.workspace === "DEMO",
          },
        ]);
      }
    }
  }
  for (const key of Object.keys(changed)) {
    (bet as Record<string, unknown>)[key] = (changes as Record<string, unknown>)[key];
  }
  bet.eventKey = eventKey(eventName, eventDate);
  bet.updatedAt = ctx.now.getTime();

  const journaled = Object.keys(changed).filter((k) => !ANNOTATION_FIELDS.has(k));
  if (bet.result !== "PENDING" && journaled.length > 0) {
    const branch = getBranchOrThrow(state, bet.branchId);
    pushEvent(state, {
      branchId: branch.id,
      type: "MANUAL_ADJUSTMENT",
      createdAt: ctx.now.getTime(),
      amountCents: null,
      capitalDeltaCents: 0,
      capitalAfterCents: branch.currentCapitalCents,
      statusAfter: branch.status,
      relatedBetId: bet.id,
      relatedBranchId: null,
      description: `Settled ticket ${state.settings.roundShortLabel}${bet.roundNumber} edited (${journaled.join(", ")})`,
      metadata: { kind: "TICKET_EDIT", changes: changed },
    });
  }
  return bet;
}
