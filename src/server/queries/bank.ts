import { z } from "zod";
import type { Cents } from "@/domain/money";
import {
  BANK_DESTINATIONS,
  BANK_STATUSES,
  PROFILES,
  type BankDestination,
  type Profile,
} from "@/domain/types";
import { bankStatusTotals, type BankStatusTotals } from "../services/bank-service";
import { localDay } from "../services/internal";
import type { WorkspaceState } from "../state/schema";
import type { BankTransactionDTO } from "./dto";
import { indexState, toBankDTO } from "./mappers";
import { periodTotals, type PeriodTotals } from "./overview";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const bankFiltersSchema = z.object({
  branch: z.string().trim().max(40).optional().catch(undefined),
  profile: z.enum(PROFILES).optional().catch(undefined),
  destination: z.enum(BANK_DESTINATIONS).optional().catch(undefined),
  status: z.enum(BANK_STATUSES).optional().catch(undefined),
  from: z.string().regex(ISO_DATE).optional().catch(undefined),
  to: z.string().regex(ISO_DATE).optional().catch(undefined),
});
export type BankFilters = z.output<typeof bankFiltersSchema>;

export interface BankDTO {
  totalCents: Cents;
  status: BankStatusTotals;
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
  series: { day: string; cumulativeCents: Cents; withdrawnCents: Cents }[];
  branchCodes: string[];
}

function localDateBoundary(day: string, endOfDay: boolean): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d + (endOfDay ? 1 : 0));
}

export function getBankData(
  state: WorkspaceState,
  filters: BankFilters,
  now = new Date(),
): BankDTO {
  const { branchById, betById } = indexState(state);
  const all = [...state.bankTransactions].sort((a, b) => b.createdAt - a.createdAt);
  const codeOf = (branchId: string) => branchById.get(branchId)?.code ?? "?";

  const fromMs = filters.from ? localDateBoundary(filters.from, false).getTime() : -Infinity;
  const toMs = filters.to ? localDateBoundary(filters.to, true).getTime() : Infinity;
  const filtered = all.filter(
    (t) =>
      t.createdAt >= fromMs &&
      t.createdAt < toMs &&
      (!filters.branch || codeOf(t.branchId) === filters.branch.toUpperCase()) &&
      (!filters.profile || t.profile === filters.profile) &&
      (!filters.destination || t.destination === filters.destination) &&
      (!filters.status || t.status === filters.status),
  );

  const transactions = filtered.map((t) =>
    toBankDTO(t, codeOf(t.branchId), t.relatedBetId ? betById.get(t.relatedBetId) : null),
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

  // Cumulative secured vs withdrawn, per day.
  const deltas = new Map<string, { secured: Cents; withdrawn: Cents }>();
  const bump = (day: string, key: "secured" | "withdrawn", amount: Cents) => {
    const entry = deltas.get(day) ?? { secured: 0, withdrawn: 0 };
    entry[key] += amount;
    deltas.set(day, entry);
  };
  for (const t of all) {
    bump(localDay(new Date(t.createdAt)), "secured", t.amountCents);
    if (t.withdrawnAt !== null) bump(localDay(new Date(t.withdrawnAt)), "withdrawn", t.amountCents);
  }
  let secured = 0;
  let withdrawn = 0;
  const series = [...deltas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => {
      secured += d.secured;
      withdrawn += d.withdrawn;
      return { day, cumulativeCents: secured, withdrawnCents: withdrawn };
    });

  return {
    totalCents: all.reduce((s, t) => s + t.amountCents, 0),
    status: bankStatusTotals(state),
    periods: periodTotals(all, now),
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
    series,
    branchCodes: [...new Set(all.map((t) => codeOf(t.branchId)))].sort(),
  };
}
