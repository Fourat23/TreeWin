import { clvBp } from "@/domain/bets/tickets";
import { lifetimeValueCents } from "@/domain/branches/metrics";
import type {
  BankTransactionRow,
  BetRow,
  BranchEventRow,
  BranchRow,
  CandidateRow,
} from "../db/schema";
import type {
  BankTransactionDTO,
  BetDTO,
  BranchEventDTO,
  BranchSummaryDTO,
  CandidateDTO,
} from "./dto";

const ms = (date: Date | null): number | null => (date ? date.getTime() : null);

export function toBranchSummary(row: BranchRow, hasPendingTicket = false): BranchSummaryDTO {
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
    createdAt: row.createdAt.getTime(),
    diedAt: ms(row.diedAt),
    maturedAt: ms(row.maturedAt),
    lastRoundAt: ms(row.lastRoundAt),
  };
}

export function toBetDTO(row: BetRow, branch: Pick<BranchRow, "code" | "profile">): BetDTO {
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: branch.code,
    branchProfile: branch.profile,
    sequence: row.sequence,
    roundNumber: row.roundNumber,
    createdAt: row.createdAt.getTime(),
    settledAt: ms(row.settledAt),
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
    checklist: row.checklist ?? null,
    overrideReason: row.overrideReason,
    cancelledAt: ms(row.cancelledAt),
    cancelReason: row.cancelReason,
  };
}

export function toEventDTO(
  row: BranchEventRow,
  codes: ReadonlyMap<string, Pick<BranchRow, "code" | "profile">>,
): BranchEventDTO {
  const branch = codes.get(row.branchId);
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: branch?.code ?? "?",
    branchProfile: branch?.profile ?? "BALANCED",
    type: row.type,
    createdAt: row.createdAt.getTime(),
    amountCents: row.amountCents,
    capitalDeltaCents: row.capitalDeltaCents,
    capitalAfterCents: row.capitalAfterCents,
    statusAfter: row.statusAfter,
    relatedBetId: row.relatedBetId,
    relatedBranchId: row.relatedBranchId,
    relatedBranchCode: row.relatedBranchId ? (codes.get(row.relatedBranchId)?.code ?? null) : null,
    metadata: row.metadata ?? null,
    description: row.description,
  };
}

export function toBankDTO(
  row: BankTransactionRow,
  branchCode: string,
  bet: Pick<BetRow, "roundNumber" | "eventName"> | null,
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
    createdAt: row.createdAt.getTime(),
    type: row.type,
    harvestKind: row.harvestKind,
    destination: row.destination,
    notes: row.notes,
  };
}

export function toCandidateDTO(row: CandidateRow): CandidateDTO {
  return {
    id: row.id,
    createdAt: row.createdAt.getTime(),
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
    checklist: row.checklist ?? null,
    notes: row.notes,
    convertedBetId: row.convertedBetId,
  };
}
