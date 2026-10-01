import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { clvBp } from "@/domain/bets/tickets";
import type { Cents } from "@/domain/money";
import { PROFILES, type BranchEventType, type Profile } from "@/domain/types";
import type { DbOrTx } from "../db/client";
import { bankTransactions, bets, branchEvents, branches } from "../db/schema";
import { localDay } from "../services/internal";
import { loadBranchIndex } from "./branches";
import type { ActivityItemDTO } from "./dto";

const DAY_MS = 86_400_000;

export interface PeriodTotals {
  today: Cents;
  week: Cents;
  month: Cents;
  last7d: Cents;
  last30d: Cents;
  allTime: Cents;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sum amounts by period boundaries (local time; weeks start on Monday). */
export function periodTotals(
  rows: { amountCents: Cents; createdAt: number }[],
  now: Date,
): PeriodTotals {
  const today = startOfDay(now).getTime();
  const weekStart = startOfDay(now);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const last7 = today - 6 * DAY_MS;
  const last30 = today - 29 * DAY_MS;
  const totals: PeriodTotals = { today: 0, week: 0, month: 0, last7d: 0, last30d: 0, allTime: 0 };
  for (const row of rows) {
    totals.allTime += row.amountCents;
    if (row.createdAt >= today) totals.today += row.amountCents;
    if (row.createdAt >= weekStart.getTime()) totals.week += row.amountCents;
    if (row.createdAt >= monthStart) totals.month += row.amountCents;
    if (row.createdAt >= last7) totals.last7d += row.amountCents;
    if (row.createdAt >= last30) totals.last30d += row.amountCents;
  }
  return totals;
}

/** Inclusive list of local days between two timestamps. */
export function dayRange(fromMs: number, toMs: number): string[] {
  const days: string[] = [];
  const cursor = startOfDay(new Date(fromMs));
  const end = startOfDay(new Date(toMs)).getTime();
  while (cursor.getTime() <= end && days.length < 3_660) {
    days.push(localDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export interface DashboardDTO {
  isEmpty: boolean;
  totals: {
    bankCents: Cents;
    activeCapitalCents: Cents;
    ecosystemCents: Cents;
    injectedCents: Cents;
    lostCents: Cents;
    harvestedCents: Cents;
    childCapitalCents: Cents;
    netSecuredCents: Cents;
  };
  bankPeriods: PeriodTotals;
  branchCounts: {
    total: number;
    alive: number;
    active: number;
    mature: number;
    paused: number;
    dead: number;
  };
  tickets: {
    total: number;
    pending: number;
    won: number;
    lost: number;
    void: number;
    winRate: number | null;
    avgOddsBp: number | null;
    avgStakeCents: Cents | null;
    profitCents: Cents;
    avgClvBp: number | null;
    clvSample: number;
  };
  bankSeries: { day: string; cumulativeCents: Cents; dailyCents: Cents }[];
  branchSeries: { day: string; alive: number; dead: number }[];
  profiles: {
    profile: Profile;
    total: number;
    alive: number;
    dead: number;
    mature: number;
    activeCapitalCents: Cents;
    bankCents: Cents;
  }[];
  activity: ActivityItemDTO[];
}

export function getDashboard(db: DbOrTx, now = new Date()): DashboardDTO {
  const branchRows = db.select().from(branches).all();
  const bankRows = db
    .select({
      amountCents: bankTransactions.amountCents,
      createdAt: bankTransactions.createdAt,
      profile: bankTransactions.profile,
    })
    .from(bankTransactions)
    .all()
    .map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));

  const alive = branchRows.filter((b) => b.status !== "DEAD");
  const bankCents = bankRows.reduce((s, r) => s + r.amountCents, 0);
  const activeCapitalCents = alive.reduce((s, b) => s + b.currentCapitalCents, 0);
  const injectedCents = branchRows
    .filter((b) => b.birthReason === "ROOT")
    .reduce((s, b) => s + b.birthCapitalCents, 0);
  const childCapitalCents = branchRows.reduce((s, b) => s + b.totalChildCapitalGeneratedCents, 0);

  const ticketAgg = db
    .select({
      result: bets.result,
      n: sql<number>`count(*)`,
      odds: sql<number>`coalesce(sum(${bets.oddsBp}), 0)`,
      stake: sql<number>`coalesce(sum(${bets.stakeCents}), 0)`,
      profit: sql<number>`coalesce(sum(${bets.profitLossCents}), 0)`,
    })
    .from(bets)
    .where(isNull(bets.cancelledAt))
    .groupBy(bets.result)
    .all();
  const count = (r: string) => Number(ticketAgg.find((t) => t.result === r)?.n ?? 0);
  const total = ticketAgg.reduce((s, t) => s + Number(t.n), 0);
  const oddsSum = ticketAgg.reduce((s, t) => s + Number(t.odds), 0);
  const stakeSum = ticketAgg.reduce((s, t) => s + Number(t.stake), 0);
  const won = count("WON");
  const lost = count("LOST");

  const clvRows = db
    .select({ odds: bets.oddsBp, closing: bets.closingOddsBp })
    .from(bets)
    .where(and(isNull(bets.cancelledAt), sql`${bets.closingOddsBp} IS NOT NULL`))
    .all();
  const clvValues = clvRows
    .map((r) => clvBp(r.odds, r.closing))
    .filter((v): v is number => v !== null);

  // Time series.
  const firstMs = Math.min(
    ...branchRows.map((b) => b.createdAt.getTime()),
    ...bankRows.map((r) => r.createdAt),
    now.getTime(),
  );
  const days = dayRange(firstMs, now.getTime());
  const dailyBank = new Map<string, Cents>();
  for (const row of bankRows) {
    const day = localDay(new Date(row.createdAt));
    dailyBank.set(day, (dailyBank.get(day) ?? 0) + row.amountCents);
  }
  let cumulative = 0;
  const bankSeries = days.map((day) => {
    const daily = dailyBank.get(day) ?? 0;
    cumulative += daily;
    return { day, cumulativeCents: cumulative, dailyCents: daily };
  });
  const births = branchRows.map((b) => localDay(b.createdAt)).sort();
  const deaths = branchRows
    .filter((b) => b.diedAt)
    .map((b) => localDay(b.diedAt as Date))
    .sort();
  let bi = 0;
  let di = 0;
  const branchSeries = days.map((day) => {
    while (bi < births.length && (births[bi] as string) <= day) bi += 1;
    while (di < deaths.length && (deaths[di] as string) <= day) di += 1;
    return { day, alive: bi - di, dead: di };
  });

  const profiles = PROFILES.map((profile) => {
    const ofProfile = branchRows.filter((b) => b.profile === profile);
    return {
      profile,
      total: ofProfile.length,
      alive: ofProfile.filter((b) => b.status !== "DEAD").length,
      dead: ofProfile.filter((b) => b.status === "DEAD").length,
      mature: ofProfile.filter((b) => b.status === "MATURE").length,
      activeCapitalCents: ofProfile
        .filter((b) => b.status !== "DEAD")
        .reduce((s, b) => s + b.currentCapitalCents, 0),
      bankCents: bankRows
        .filter((r) => r.profile === profile)
        .reduce((s, r) => s + r.amountCents, 0),
    };
  });

  return {
    isEmpty: branchRows.length === 0,
    totals: {
      bankCents,
      activeCapitalCents,
      ecosystemCents: bankCents + activeCapitalCents,
      injectedCents,
      lostCents: branchRows.reduce((s, b) => s + b.totalLostCents, 0),
      harvestedCents: bankCents + childCapitalCents,
      childCapitalCents,
      netSecuredCents: bankCents - injectedCents,
    },
    bankPeriods: periodTotals(bankRows, now),
    branchCounts: {
      total: branchRows.length,
      alive: alive.length,
      active: branchRows.filter((b) => b.status === "ACTIVE").length,
      mature: branchRows.filter((b) => b.status === "MATURE").length,
      paused: branchRows.filter((b) => b.status === "PAUSED").length,
      dead: branchRows.length - alive.length,
    },
    tickets: {
      total,
      pending: count("PENDING"),
      won,
      lost,
      void: count("VOID"),
      winRate: won + lost > 0 ? won / (won + lost) : null,
      avgOddsBp: total > 0 ? Math.round(oddsSum / total) : null,
      avgStakeCents: total > 0 ? Math.round(stakeSum / total) : null,
      profitCents: ticketAgg.reduce((s, t) => s + Number(t.profit), 0),
      avgClvBp:
        clvValues.length > 0
          ? Math.round(clvValues.reduce((s, v) => s + v, 0) / clvValues.length)
          : null,
      clvSample: clvValues.length,
    },
    bankSeries,
    branchSeries,
    profiles,
    activity: getActivityFeed(db, { limit: 14 }).items,
  };
}

/** Event types shown in human activity feeds (SPLIT/BET_CREATED are summarised elsewhere). */
export const FEED_EVENT_TYPES: BranchEventType[] = [
  "BIRTH",
  "BET_CREATED",
  "BET_WON",
  "BET_LOST",
  "BET_VOID",
  "BET_CANCELLED",
  "HARVEST",
  "BANK_TRANSFER",
  "CHILD_CREATED",
  "CAP_REACHED",
  "DEATH",
  "PROFILE_CHANGED",
  "STATUS_CHANGED",
  "MANUAL_ADJUSTMENT",
];

export function getActivityFeed(
  db: DbOrTx,
  options: { limit?: number; before?: number; branchId?: string; types?: BranchEventType[] } = {},
): { items: ActivityItemDTO[]; nextCursor: number | null } {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const index = loadBranchIndex(db);
  const rows = db
    .select()
    .from(branchEvents)
    .where(
      and(
        inArray(branchEvents.type, options.types ?? FEED_EVENT_TYPES),
        options.before ? lt(branchEvents.id, options.before) : undefined,
        options.branchId ? eq(branchEvents.branchId, options.branchId) : undefined,
      ),
    )
    .orderBy(desc(branchEvents.id))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => {
      const branch = index.get(r.branchId);
      return {
        id: r.id,
        type: r.type,
        branchId: r.branchId,
        branchCode: branch?.code ?? "?",
        profile: branch?.profile ?? "BALANCED",
        createdAt: r.createdAt.getTime(),
        amountCents: r.amountCents,
        capitalDeltaCents: r.capitalDeltaCents,
        description: r.description,
        relatedBranchId: r.relatedBranchId,
        relatedBranchCode: r.relatedBranchId ? (index.get(r.relatedBranchId)?.code ?? null) : null,
      };
    }),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}
