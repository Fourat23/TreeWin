import { clvBp } from "@/domain/bets/tickets";
import { lifetimeValueCents } from "@/domain/branches/metrics";
import type {
  BankTransactionRecord,
  BetRecord,
  BranchEventRecord,
  BranchRecord,
  CandidateRecord,
  WorkspaceState,
} from "../state/schema";
import type {
  BankTransactionDTO,
  BetDTO,
  BranchEventDTO,
  BranchSummaryDTO,
  CandidateDTO,
} from "./dto";

/**
 * Read-side index of a workspace state. States handed out by the repository are immutable,
 * so the index is computed once per state object and cached.
 */
export interface StateIndex {
  branchById: ReadonlyMap<string, BranchRecord>;
  betById: ReadonlyMap<string, BetRecord>;
  /** Branch ids holding an open (pending, not cancelled) ticket. */
  pendingBranchIds: ReadonlySet<string>;
}

const indexCache = new WeakMap<WorkspaceState, StateIndex>();

export function indexState(state: WorkspaceState): StateIndex {
  const cached = indexCache.get(state);
  if (cached) return cached;
  const index: StateIndex = {
    branchById: new Map(state.branches.map((b) => [b.id, b])),
    betById: new Map(state.bets.map((b) => [b.id, b])),
    pendingBranchIds: new Set(
      state.bets
        .filter((b) => b.result === "PENDING" && b.cancelledAt === null)
        .map((b) => b.branchId),
    ),
  };
  indexCache.set(state, index);
  return index;
}

export function toBranchSummary(row: BranchRecord, hasPendingTicket = false): BranchSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    parentId: row.parentId,
    generation: row.generation,
    profile: row.profile,
    status: row.status,
    birthReason: row.birthReason,
    birthCapitalCents: row.birthCapitalCents,
    currentCapitalCents: row.currentCapitalCents,
    capCents: row.capCents,
    peakCapitalCents: row.peakCapitalCents,
    totalBankGeneratedCents: row.totalBankGeneratedCents,
    totalChildCapitalGeneratedCents: row.totalChildCapitalGeneratedCents,
    totalLostCents: row.totalLostCents,
    ltvCents: lifetimeValueCents(row),
    wins: row.wins,
    losses: row.losses,
    voids: row.voids,
    roundCount: row.roundCount,
    childCount: row.childCount,
    hasPendingTicket,
    createdAt: row.createdAt,
    diedAt: row.diedAt,
    maturedAt: row.maturedAt,
    lastRoundAt: row.lastRoundAt,
    strategyVersion: row.strategyVersion,
    strategyRevision: row.strategyRevision,
  };
}

export function toBetDTO(
  row: BetRecord,
  branch: Pick<BranchRecord, "code" | "profile"> | undefined,
): BetDTO {
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: branch?.code ?? "?",
    branchProfile: branch?.profile ?? "BALANCED",
    sequence: row.sequence,
    roundNumber: row.roundNumber,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    eventDate: row.eventDate,
    eventTime: row.eventTime,
    sport: row.sport,
    competition: row.competition,
    eventName: row.eventName,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    marketName: row.marketName,
    selection: row.selection,
    bookmaker: row.bookmaker,
    oddsBp: row.oddsBp,
    stakeCents: row.stakeCents,
    potentialReturnCents: row.potentialReturnCents,
    result: row.result,
    actualReturnCents: row.actualReturnCents,
    profitLossCents: row.profitLossCents,
    capitalBeforeCents: row.capitalBeforeCents,
    capitalAfterCents: row.capitalAfterCents,
    countsAsRound: row.countsAsRound,
    closingOddsBp: row.closingOddsBp,
    clvBp: clvBp(row.oddsBp, row.closingOddsBp),
    notes: row.notes,
    protocolStatus: row.protocolStatus,
    confidence: row.confidence,
    checklist: row.checklist ? { ...row.checklist } : null,
    overrideReason: row.overrideReason,
    outsideV1: row.outsideV1,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    strategyVersion: row.strategyVersion,
    strategyRevision: row.strategyRevision,
  };
}

export function toEventDTO(
  row: BranchEventRecord,
  branches: ReadonlyMap<string, Pick<BranchRecord, "code" | "profile">>,
): BranchEventDTO {
  const branch = branches.get(row.branchId);
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: branch?.code ?? "?",
    branchProfile: branch?.profile ?? "BALANCED",
    type: row.type,
    createdAt: row.createdAt,
    amountCents: row.amountCents,
    capitalDeltaCents: row.capitalDeltaCents,
    capitalAfterCents: row.capitalAfterCents,
    statusAfter: row.statusAfter,
    relatedBetId: row.relatedBetId,
    relatedBranchId: row.relatedBranchId,
    relatedBranchCode: row.relatedBranchId
      ? (branches.get(row.relatedBranchId)?.code ?? null)
      : null,
    metadata: row.metadata ? structuredClone(row.metadata) : null,
    description: row.description,
  };
}

export function toBankDTO(
  row: BankTransactionRecord,
  branchCode: string,
  bet: Pick<BetRecord, "roundNumber" | "eventName"> | null | undefined,
): BankTransactionDTO {
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode,
    profile: row.profile,
    relatedBetId: row.relatedBetId,
    roundNumber: bet?.roundNumber ?? null,
    eventName: bet?.eventName ?? null,
    amountCents: row.amountCents,
    createdAt: row.createdAt,
    type: row.type,
    harvestKind: row.harvestKind,
    status: row.status,
    withdrawnAt: row.withdrawnAt,
    destination: row.destination,
    notes: row.notes,
  };
}

export function toCandidateDTO(row: CandidateRecord): CandidateDTO {
  return {
    id: row.id,
    createdAt: row.createdAt,
    eventDate: row.eventDate,
    eventTime: row.eventTime,
    sport: row.sport,
    competition: row.competition,
    eventName: row.eventName,
    marketName: row.marketName,
    selection: row.selection,
    oddsObservedBp: row.oddsObservedBp,
    closingOddsBp: row.closingOddsBp,
    clvBp: clvBp(row.oddsObservedBp, row.closingOddsBp),
    protocolStatus: row.protocolStatus,
    result: row.result,
    checklist: row.checklist ? { ...row.checklist } : null,
    notes: row.notes,
    convertedBetId: row.convertedBetId,
  };
}
