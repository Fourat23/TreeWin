import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { emptyProfileCounts, type ProfileCounts } from "@/domain/branches/profile-picker";
import { formatMoney, type Cents } from "@/domain/money";
import type { BranchState } from "@/domain/strategy/engine";
import type { StrategySettings } from "@/domain/strategy/settings";
import { PROFILES } from "@/domain/types";
import type { DbOrTx } from "../db/client";
import { bets, branchEvents, branches, type BranchRow, type NewBranchEventRow } from "../db/schema";
import { DomainError, notFound } from "./errors";

export const newId = (): string => randomUUID();

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new DomainError("VALIDATION", issues[0]?.message ?? "Invalid input", { issues });
  }
  return parsed.data;
}

export function moneyFormatter(
  settings: StrategySettings,
): (cents: Cents, signed?: boolean) => string {
  return (cents, signed = false) =>
    formatMoney(cents, { locale: settings.locale, currency: settings.currency, signed });
}

export function insertEvent(tx: DbOrTx, event: NewBranchEventRow): number {
  const row = tx.insert(branchEvents).values(event).returning({ id: branchEvents.id }).get();
  return row.id;
}

export function getBranchOrThrow(tx: DbOrTx, branchId: string): BranchRow {
  const row = tx.select().from(branches).where(eq(branches.id, branchId)).get();
  if (!row) throw notFound("Branch", branchId);
  return row;
}

export function findBranchByIdOrCode(tx: DbOrTx, idOrCode: string): BranchRow | undefined {
  return (
    tx.select().from(branches).where(eq(branches.id, idOrCode)).get() ??
    tx.select().from(branches).where(eq(branches.code, idOrCode)).get()
  );
}

export function hasPendingTicket(tx: DbOrTx, branchId: string): boolean {
  const row = tx
    .select({ id: bets.id })
    .from(bets)
    .where(and(eq(bets.branchId, branchId), eq(bets.result, "PENDING"), isNull(bets.cancelledAt)))
    .get();
  return Boolean(row);
}

export function toBranchState(row: BranchRow): BranchState {
  return {
    code: row.code,
    profile: row.profile,
    status: row.status,
    birthCapitalCents: row.birthCapitalCents,
    currentCapitalCents: row.currentCapitalCents,
    capCents: row.capCents,
    p1Done: row.p1Done,
    thresholdLevel: row.thresholdLevel,
    wins: row.wins,
    losses: row.losses,
    voids: row.voids,
    roundCount: row.roundCount,
    childCount: row.childCount,
  };
}

/**
 * Profile counts used by QUOTA assignment: only automatically created branches
 * (roots are chosen by hand and would otherwise skew the distribution).
 */
export function automaticProfileCounts(tx: DbOrTx): ProfileCounts {
  const rows = tx
    .select({ profile: branches.profile, count: sql<number>`count(*)` })
    .from(branches)
    .where(ne(branches.birthReason, "ROOT"))
    .groupBy(branches.profile)
    .all();
  const counts = emptyProfileCounts();
  for (const row of rows) {
    if ((PROFILES as readonly string[]).includes(row.profile))
      counts[row.profile] = Number(row.count);
  }
  return counts;
}

/** Local calendar day (YYYY-MM-DD) of a date, in the server's timezone. */
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
