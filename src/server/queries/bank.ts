import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Cents } from "@/domain/money";
import { BANK_DESTINATIONS, PROFILES, type BankDestination, type Profile } from "@/domain/types";
import type { DbOrTx } from "../db/client";
import { bankTransactions, bets, branches } from "../db/schema";
import { localDay } from "../services/internal";
import type { BankTransactionDTO } from "./dto";
import { toBankDTO } from "./mappers";
import { periodTotals, type PeriodTotals } from "./overview";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const bankFiltersSchema = z.object({
  branch: z.string().trim().max(40).optional().catch(undefined),
  profile: z.enum(PROFILES).optional().catch(undefined),
  destination: z.enum(BANK_DESTINATIONS).optional().catch(undefined),
  from: z.string().regex(ISO_DATE).optional().catch(undefined),
  to: z.string().regex(ISO_DATE).optional().catch(undefined),
});
export type BankFilters = z.output<typeof bankFiltersSchema>;

export interface BankDTO {
  totalCents: Cents;
  periods: PeriodTotals;
  filteredTotalCents: Cents;
  transactions: BankTransactionDTO[];
  byBranch: {
    branchId: string;
    code: string;
    profile: Profile;
    amountCents: Cents;
    count: number;
  }[];
  byProfile: { profile: Profile; amountCents: Cents; count: number }[];
  byDestination: { destination: BankDestination; amountCents: Cents; count: number }[];
  series: { day: string; cumulativeCents: Cents }[];
  branchCodes: string[];
}

function localDateBoundary(day: string, endOfDay: boolean): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d + (endOfDay ? 1 : 0));
}

export function getBankData(db: DbOrTx, filters: BankFilters, now = new Date()): BankDTO {
  const all = db
    .select({
      tx: bankTransactions,
      code: branches.code,
      round: bets.roundNumber,
      eventName: bets.eventName,
    })
    .from(bankTransactions)
    .innerJoin(branches, eq(bankTransactions.branchId, branches.id))
    .leftJoin(bets, eq(bankTransactions.relatedBetId, bets.id))
    .orderBy(desc(bankTransactions.createdAt))
    .all();

  const fromMs = filters.from ? localDateBoundary(filters.from, false).getTime() : -Infinity;
  const toMs = filters.to ? localDateBoundary(filters.to, true).getTime() : Infinity;
  const filtered = all.filter((r) => {
    const at = r.tx.createdAt.getTime();
    return (
      at >= fromMs &&
      at < toMs &&
      (!filters.branch || r.code === filters.branch.toUpperCase()) &&
      (!filters.profile || r.tx.profile === filters.profile) &&
      (!filters.destination || r.tx.destination === filters.destination)
    );
  });

  const transactions = filtered.map((r) =>
    toBankDTO(
      r.tx,
      r.code,
      r.round !== null ? { roundNumber: r.round, eventName: r.eventName ?? "" } : null,
    ),
  );

  const byBranchMap = new Map<string, BankDTO["byBranch"][number]>();
  for (const t of transactions) {
    const entry = byBranchMap.get(t.branchId) ?? {
      branchId: t.branchId,
      code: t.branchCode,
      profile: t.profile,
      amountCents: 0,
      count: 0,
    };
    entry.amountCents += t.amountCents;
    entry.count += 1;
    byBranchMap.set(t.branchId, entry);
  }

  const chronological = [...all].reverse();
  let cumulative = 0;
  const seriesMap = new Map<string, Cents>();
  for (const r of chronological) {
    cumulative += r.tx.amountCents;
    seriesMap.set(localDay(r.tx.createdAt), cumulative);
  }

  return {
    totalCents: all.reduce((s, r) => s + r.tx.amountCents, 0),
    periods: periodTotals(
      all.map((r) => ({ amountCents: r.tx.amountCents, createdAt: r.tx.createdAt.getTime() })),
      now,
    ),
    filteredTotalCents: transactions.reduce((s, t) => s + t.amountCents, 0),
    transactions,
    byBranch: [...byBranchMap.values()].sort((a, b) => b.amountCents - a.amountCents),
    byProfile: PROFILES.map((profile) => {
      const ofProfile = transactions.filter((t) => t.profile === profile);
      return {
        profile,
        amountCents: ofProfile.reduce((s, t) => s + t.amountCents, 0),
        count: ofProfile.length,
      };
    }),
    byDestination: BANK_DESTINATIONS.map((destination) => {
      const ofDestination = transactions.filter((t) => t.destination === destination);
      return {
        destination,
        amountCents: ofDestination.reduce((s, t) => s + t.amountCents, 0),
        count: ofDestination.length,
      };
    }),
    series: [...seriesMap.entries()].map(([day, cumulativeCents]) => ({ day, cumulativeCents })),
    branchCodes: [...new Set(all.map((r) => r.code))].sort(),
  };
}
