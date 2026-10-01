import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { parseOdds } from "@/domain/money";
import { BET_RESULTS, PROFILES } from "@/domain/types";
import type { DbOrTx } from "../db/client";
import { bankTransactions, bets, branchEvents, branches } from "../db/schema";
import { checkRevertible, type RevertCheck } from "../services/bet-service";
import { loadBranchIndex } from "./branches";
import type { BankTransactionDTO, BetDTO, BranchEventDTO, BranchSummaryDTO } from "./dto";
import { toBankDTO, toBetDTO, toBranchSummary, toEventDTO } from "./mappers";

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
export type TicketStatusFilter = (typeof TICKET_STATUSES)[number];

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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildWhere(filters: TicketFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    conditions.push(
      or(
        sql`${bets.eventName} LIKE ${like} ESCAPE '\\'`,
        sql`${bets.selection} LIKE ${like} ESCAPE '\\'`,
        sql`${bets.competition} LIKE ${like} ESCAPE '\\'`,
        sql`${bets.marketName} LIKE ${like} ESCAPE '\\'`,
        sql`${bets.notes} LIKE ${like} ESCAPE '\\'`,
        sql`${branches.code} LIKE ${like} ESCAPE '\\'`,
      ),
    );
  }
  if (filters.branch) conditions.push(eq(branches.code, filters.branch.toUpperCase()));
  if (filters.profile) conditions.push(eq(branches.profile, filters.profile));
  if (filters.sport) conditions.push(eq(bets.sport, filters.sport));
  if (filters.competition) conditions.push(eq(bets.competition, filters.competition));
  if (filters.status === "CANCELLED") conditions.push(isNotNull(bets.cancelledAt));
  else if (filters.status) {
    conditions.push(eq(bets.result, filters.status), isNull(bets.cancelledAt));
  }
  if (filters.from) conditions.push(gte(bets.eventDate, filters.from));
  if (filters.to) conditions.push(lte(bets.eventDate, filters.to));
  const oddsMin = filters.oddsMin ? parseOdds(filters.oddsMin) : null;
  const oddsMax = filters.oddsMax ? parseOdds(filters.oddsMax) : null;
  if (oddsMin) conditions.push(gte(bets.oddsBp, oddsMin));
  if (oddsMax) conditions.push(lte(bets.oddsBp, oddsMax));
  return and(...conditions);
}

function orderBy(filters: TicketFilters): SQL[] {
  const dir = filters.dir === "asc" ? asc : desc;
  switch (filters.sort) {
    case "event":
      return [dir(bets.eventDate), dir(bets.eventTime), dir(bets.createdAt)];
    case "odds":
      return [dir(bets.oddsBp), desc(bets.createdAt)];
    case "stake":
      return [dir(bets.stakeCents), desc(bets.createdAt)];
    case "profit":
      return [dir(sql`coalesce(${bets.profitLossCents}, 0)`), desc(bets.createdAt)];
    case "round":
      return [dir(bets.roundNumber), dir(branches.code)];
    case "branch":
      return [dir(branches.code), dir(bets.sequence)];
    case "created":
      return [dir(bets.createdAt), dir(bets.sequence)];
  }
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

export function listTickets(db: DbOrTx, filters: TicketFilters): TicketListDTO {
  const where = buildWhere(filters);
  const totals = db
    .select({
      n: sql<number>`count(*)`,
      stake: sql<number>`coalesce(sum(${bets.stakeCents}), 0)`,
      profit: sql<number>`coalesce(sum(${bets.profitLossCents}), 0)`,
      won: sql<number>`sum(case when ${bets.result} = 'WON' and ${bets.cancelledAt} is null then 1 else 0 end)`,
      lost: sql<number>`sum(case when ${bets.result} = 'LOST' and ${bets.cancelledAt} is null then 1 else 0 end)`,
      voided: sql<number>`sum(case when ${bets.result} = 'VOID' and ${bets.cancelledAt} is null then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${bets.result} = 'PENDING' and ${bets.cancelledAt} is null then 1 else 0 end)`,
    })
    .from(bets)
    .innerJoin(branches, eq(bets.branchId, branches.id))
    .where(where)
    .get();
  const total = Number(totals?.n ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const rows = db
    .select({ bet: bets, code: branches.code, profile: branches.profile })
    .from(bets)
    .innerJoin(branches, eq(bets.branchId, branches.id))
    .where(where)
    .orderBy(...orderBy(filters))
    .limit(TICKETS_PAGE_SIZE)
    .offset((page - 1) * TICKETS_PAGE_SIZE)
    .all();

  const distinct = (column: typeof bets.sport | typeof bets.competition) =>
    db
      .selectDistinct({ value: column })
      .from(bets)
      .orderBy(asc(column))
      .all()
      .map((r) => r.value);

  return {
    rows: rows.map((r) => toBetDTO(r.bet, { code: r.code, profile: r.profile })),
    total,
    page,
    pageCount,
    summary: {
      stakeCents: Number(totals?.stake ?? 0),
      profitCents: Number(totals?.profit ?? 0),
      won: Number(totals?.won ?? 0),
      lost: Number(totals?.lost ?? 0),
      void: Number(totals?.voided ?? 0),
      pending: Number(totals?.pending ?? 0),
    },
    facets: {
      sports: distinct(bets.sport),
      competitions: distinct(bets.competition),
      branches: db
        .select({ code: branches.code })
        .from(branches)
        .orderBy(asc(branches.code))
        .all()
        .map((r) => r.code),
    },
  };
}

export interface TicketDetailDTO {
  bet: BetDTO;
  branch: BranchSummaryDTO;
  events: BranchEventDTO[];
  children: BranchSummaryDTO[];
  bankTransactions: BankTransactionDTO[];
  revert: RevertCheck;
}

export function getTicketDetail(db: DbOrTx, betId: string): TicketDetailDTO | null {
  const bet = db.select().from(bets).where(eq(bets.id, betId)).get();
  if (!bet) return null;
  const branch = db.select().from(branches).where(eq(branches.id, bet.branchId)).get();
  if (!branch) return null;
  const index = loadBranchIndex(db);
  const pending = bet.result === "PENDING" && !bet.cancelledAt;
  return {
    bet: toBetDTO(bet, branch),
    branch: toBranchSummary(branch, pending),
    events: db
      .select()
      .from(branchEvents)
      .where(eq(branchEvents.relatedBetId, bet.id))
      .orderBy(asc(branchEvents.id))
      .all()
      .map((e) => toEventDTO(e, index)),
    children: db
      .select()
      .from(branches)
      .where(eq(branches.birthBetId, bet.id))
      .orderBy(asc(branches.code))
      .all()
      .map((c) => toBranchSummary(c)),
    bankTransactions: db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.relatedBetId, bet.id))
      .all()
      .map((t) => toBankDTO(t, branch.code, bet)),
    revert: checkRevertible(db, bet.id),
  };
}
