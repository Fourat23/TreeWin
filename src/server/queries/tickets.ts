import { z } from "zod";
import { parseOdds } from "@/domain/money";
import { BET_RESULTS, PROFILES } from "@/domain/types";
import type { BetRecord, BranchRecord, WorkspaceState } from "../state/schema";
import type { BankTransactionDTO, BetDTO, BranchEventDTO, BranchSummaryDTO } from "./dto";
import { indexState, toBankDTO, toBetDTO, toBranchSummary, toEventDTO } from "./mappers";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const optionalString = z.string().trim().max(120).optional().catch(undefined);

export const TICKET_SORTS = [
  "created",
  "event",
  "odds",
  "stake",
  "profit",
  "round",
  "branch",
] as const;
export const TICKET_STATUSES = [...BET_RESULTS, "CANCELLED"] as const;

/** Filters read from the URL; invalid values are dropped instead of failing the page. */
export const ticketFiltersSchema = z.object({
  q: optionalString,
  branch: optionalString,
  profile: z.enum(PROFILES).optional().catch(undefined),
  sport: optionalString,
  competition: optionalString,
  status: z.enum(TICKET_STATUSES).optional().catch(undefined),
  from: z.string().regex(ISO_DATE).optional().catch(undefined),
  to: z.string().regex(ISO_DATE).optional().catch(undefined),
  oddsMin: optionalString,
  oddsMax: optionalString,
  sort: z.enum(TICKET_SORTS).default("created").catch("created"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).max(100_000).default(1).catch(1),
});
export type TicketFilters = z.output<typeof ticketFiltersSchema>;

export const TICKETS_PAGE_SIZE = 50;

type Row = { bet: BetRecord; branch: BranchRecord };

function matches(
  row: Row,
  filters: TicketFilters,
  oddsMin: number | null,
  oddsMax: number | null,
): boolean {
  const { bet, branch } = row;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    const haystack = [
      bet.eventName,
      bet.selection,
      bet.competition,
      bet.marketName,
      bet.notes ?? "",
      branch.code,
    ];
    if (!haystack.some((v) => v.toLowerCase().includes(q))) return false;
  }
  if (filters.branch && branch.code !== filters.branch.toUpperCase()) return false;
  if (filters.profile && branch.profile !== filters.profile) return false;
  if (filters.sport && bet.sport !== filters.sport) return false;
  if (filters.competition && bet.competition !== filters.competition) return false;
  if (filters.status === "CANCELLED") {
    if (bet.cancelledAt === null) return false;
  } else if (filters.status && (bet.result !== filters.status || bet.cancelledAt !== null)) {
    return false;
  }
  if (filters.from && bet.eventDate < filters.from) return false;
  if (filters.to && bet.eventDate > filters.to) return false;
  if (oddsMin && bet.oddsBp < oddsMin) return false;
  if (oddsMax && bet.oddsBp > oddsMax) return false;
  return true;
}

function compareRows(filters: TicketFilters): (a: Row, b: Row) => number {
  const sign = filters.dir === "asc" ? 1 : -1;
  const cmp = (x: number | string, y: number | string) => (x < y ? -1 : x > y ? 1 : 0);
  return (a, b) => {
    const keys: [number | string, number | string][] = (() => {
      switch (filters.sort) {
        case "event":
          return [
            [a.bet.eventDate, b.bet.eventDate],
            [a.bet.eventTime ?? "", b.bet.eventTime ?? ""],
            [a.bet.createdAt, b.bet.createdAt],
          ];
        case "odds":
          return [[a.bet.oddsBp, b.bet.oddsBp]];
        case "stake":
          return [[a.bet.stakeCents, b.bet.stakeCents]];
        case "profit":
          return [[a.bet.profitLossCents ?? 0, b.bet.profitLossCents ?? 0]];
        case "round":
          return [
            [a.bet.roundNumber, b.bet.roundNumber],
            [a.branch.code, b.branch.code],
          ];
        case "branch":
          return [
            [a.branch.code, b.branch.code],
            [a.bet.sequence, b.bet.sequence],
          ];
        case "created":
          return [
            [a.bet.createdAt, b.bet.createdAt],
            [a.bet.sequence, b.bet.sequence],
          ];
      }
    })();
    for (const [x, y] of keys) {
      const c = cmp(x, y);
      if (c !== 0) return sign * c;
    }
    return b.bet.createdAt - a.bet.createdAt;
  };
}

export interface TicketListDTO {
  rows: BetDTO[];
  total: number;
  page: number;
  pageCount: number;
  summary: {
    stakeCents: number;
    profitCents: number;
    won: number;
    lost: number;
    void: number;
    pending: number;
  };
  facets: { sports: string[]; competitions: string[]; branches: string[] };
}

export function listTickets(state: WorkspaceState, filters: TicketFilters): TicketListDTO {
  const { branchById } = indexState(state);
  const oddsMin = filters.oddsMin ? parseOdds(filters.oddsMin) : null;
  const oddsMax = filters.oddsMax ? parseOdds(filters.oddsMax) : null;
  const all: Row[] = [];
  for (const bet of state.bets) {
    const branch = branchById.get(bet.branchId);
    if (branch) all.push({ bet, branch });
  }
  const filtered = all
    .filter((r) => matches(r, filters, oddsMin, oddsMax))
    .sort(compareRows(filters));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const live = filtered.filter((r) => r.bet.cancelledAt === null);
  const countOf = (result: string) => live.filter((r) => r.bet.result === result).length;
  const distinct = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

  return {
    rows: filtered
      .slice((page - 1) * TICKETS_PAGE_SIZE, page * TICKETS_PAGE_SIZE)
      .map((r) => toBetDTO(r.bet, r.branch)),
    total,
    page,
    pageCount,
    summary: {
      stakeCents: filtered.reduce((s, r) => s + r.bet.stakeCents, 0),
      profitCents: filtered.reduce((s, r) => s + (r.bet.profitLossCents ?? 0), 0),
      won: countOf("WON"),
      lost: countOf("LOST"),
      void: countOf("VOID"),
      pending: countOf("PENDING"),
    },
    facets: {
      sports: distinct(state.bets.map((b) => b.sport)),
      competitions: distinct(state.bets.map((b) => b.competition)),
      branches: distinct(state.branches.map((b) => b.code)),
    },
  };
}

/** Which corrections the UI may offer for a ticket. */
export interface TicketCorrections {
  canEdit: boolean;
  canCancel: boolean;
  canReopen: boolean;
  /** Settled tickets are deleted "from this point" (with everything after them on the branch). */
  canDelete: boolean;
  laterTickets: number;
}

export interface TicketDetailDTO {
  bet: BetDTO;
  branch: BranchSummaryDTO;
  events: BranchEventDTO[];
  children: BranchSummaryDTO[];
  bankTransactions: BankTransactionDTO[];
  corrections: TicketCorrections;
}

export function getTicketDetail(state: WorkspaceState, betId: string): TicketDetailDTO | null {
  const { branchById, betById, pendingBranchIds } = indexState(state);
  const bet = betById.get(betId);
  if (!bet) return null;
  const branch = branchById.get(bet.branchId);
  if (!branch) return null;
  const open = bet.result === "PENDING" && bet.cancelledAt === null;
  const settled = bet.result !== "PENDING";
  return {
    bet: toBetDTO(bet, branch),
    branch: toBranchSummary(branch, pendingBranchIds.has(branch.id)),
    events: state.branchEvents
      .filter((e) => e.relatedBetId === bet.id)
      .sort((a, b) => a.id - b.id)
      .map((e) => toEventDTO(e, branchById)),
    children: state.branches
      .filter((b) => b.birthBetId === bet.id)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => toBranchSummary(c, pendingBranchIds.has(c.id))),
    bankTransactions: state.bankTransactions
      .filter((t) => t.relatedBetId === bet.id)
      .map((t) => toBankDTO(t, branch.code, bet)),
    corrections: {
      canEdit: true,
      canCancel: open,
      canReopen: settled,
      canDelete: true,
      laterTickets: state.bets.filter((b) => b.branchId === branch.id && b.sequence > bet.sequence)
        .length,
    },
  };
}
