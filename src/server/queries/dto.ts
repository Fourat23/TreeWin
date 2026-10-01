/**
 * Serializable read models handed from the server to React components.
 * Dates are epoch milliseconds so they cross the server/client boundary unchanged.
 */
import type { LedgerCheck } from "@/domain/branches/metrics";
import type { Cents } from "@/domain/money";
import type {
  BankDestination,
  BankStatus,
  BankTxType,
  BetResult,
  BirthReason,
  BranchEventType,
  BranchStatus,
  CandidateStatus,
  Checklist,
  HarvestKind,
  Profile,
  ProtocolStatus,
} from "@/domain/types";

export interface BranchSummaryDTO {
  id: string;
  code: string;
  parentId: string | null;
  generation: number;
  profile: Profile;
  status: BranchStatus;
  birthReason: BirthReason;
  birthCapitalCents: Cents;
  currentCapitalCents: Cents;
  capCents: Cents;
  peakCapitalCents: Cents;
  totalBankGeneratedCents: Cents;
  totalChildCapitalGeneratedCents: Cents;
  totalLostCents: Cents;
  ltvCents: Cents;
  wins: number;
  losses: number;
  voids: number;
  roundCount: number;
  childCount: number;
  hasPendingTicket: boolean;
  createdAt: number;
  diedAt: number | null;
  maturedAt: number | null;
  lastRoundAt: number | null;
  strategyVersion: string;
  strategyRevision: number;
}

export interface BetDTO {
  id: string;
  branchId: string;
  branchCode: string;
  branchProfile: Profile;
  sequence: number;
  roundNumber: number;
  createdAt: number;
  settledAt: number | null;
  eventDate: string;
  eventTime: string | null;
  sport: string;
  competition: string;
  eventName: string;
  homeTeam: string | null;
  awayTeam: string | null;
  marketName: string;
  selection: string;
  bookmaker: string;
  oddsBp: number;
  stakeCents: Cents;
  potentialReturnCents: Cents;
  result: BetResult;
  actualReturnCents: Cents | null;
  profitLossCents: Cents | null;
  capitalBeforeCents: Cents;
  capitalAfterCents: Cents | null;
  countsAsRound: boolean | null;
  closingOddsBp: number | null;
  clvBp: number | null;
  notes: string | null;
  protocolStatus: ProtocolStatus | null;
  confidence: number | null;
  checklist: Checklist | null;
  overrideReason: string | null;
  outsideV1: boolean;
  cancelledAt: number | null;
  cancelReason: string | null;
  strategyVersion: string;
  strategyRevision: number;
}

export interface BranchEventDTO {
  id: number;
  branchId: string;
  branchCode: string;
  branchProfile: Profile;
  type: BranchEventType;
  createdAt: number;
  amountCents: Cents | null;
  capitalDeltaCents: Cents;
  capitalAfterCents: Cents | null;
  statusAfter: BranchStatus | null;
  relatedBetId: string | null;
  relatedBranchId: string | null;
  relatedBranchCode: string | null;
  metadata: Record<string, unknown> | null;
  description: string;
}

export interface BankTransactionDTO {
  id: string;
  branchId: string;
  branchCode: string;
  profile: Profile;
  relatedBetId: string | null;
  roundNumber: number | null;
  eventName: string | null;
  amountCents: Cents;
  createdAt: number;
  type: BankTxType;
  harvestKind: HarvestKind | null;
  status: BankStatus;
  withdrawnAt: number | null;
  destination: BankDestination;
  notes: string | null;
}

export type MilestoneDTO =
  | {
      kind: "P1" | "THRESHOLD" | "CAP";
      label: string;
      thresholdCents: Cents;
      progress: number;
      detail: string;
    }
  | { kind: "NONE"; label: string; detail: string };

export interface BranchDetailDTO {
  branch: BranchSummaryDTO & { notes: string | null; birthBetId: string | null };
  parent: Pick<BranchSummaryDTO, "id" | "code" | "profile" | "status"> | null;
  children: BranchSummaryDTO[];
  bets: BetDTO[];
  events: BranchEventDTO[];
  bankTransactions: BankTransactionDTO[];
  ledger: LedgerCheck;
  stats: {
    winRate: number | null;
    avgOddsBp: number | null;
    bestStreak: number;
    roiBp: number;
    descendants: number;
    aliveDescendants: number;
    lifespanDays: number;
  };
  milestone: MilestoneDTO;
  suggestedStakeCents: Cents;
  pendingBetId: string | null;
}

export interface ActivityItemDTO {
  id: number;
  type: BranchEventType;
  branchId: string;
  branchCode: string;
  profile: Profile;
  createdAt: number;
  amountCents: Cents | null;
  capitalDeltaCents: Cents;
  description: string;
  relatedBranchId: string | null;
  relatedBranchCode: string | null;
}

export interface CandidateDTO {
  id: string;
  createdAt: number;
  eventDate: string;
  eventTime: string | null;
  sport: string;
  competition: string;
  eventName: string;
  marketName: string;
  selection: string;
  oddsObservedBp: number;
  closingOddsBp: number | null;
  clvBp: number | null;
  protocolStatus: CandidateStatus;
  result: BetResult;
  checklist: Checklist | null;
  notes: string | null;
  convertedBetId: string | null;
}

export interface PlayableBranchDTO {
  id: string;
  code: string;
  profile: Profile;
  status: BranchStatus;
  currentCapitalCents: Cents;
  capCents: Cents;
  suggestedStakeCents: Cents;
  roundCount: number;
  nextRoundNumber: number;
}
