import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { emptyProfileCounts, type ProfileCounts } from "@/domain/branches/profile-picker";
import { formatMoney, type Cents } from "@/domain/money";
import type { BranchState } from "@/domain/strategy/engine";
import type { StrategySettings } from "@/domain/strategy/settings";
import type { Workspace } from "@/domain/types";
import type { BetRecord, BranchEventRecord, BranchRecord, WorkspaceState } from "../state/schema";
import { DomainError, notFound } from "./errors";

/** What every state operation receives besides the draft state. */
export interface OpContext {
  workspace: Workspace;
  now: Date;
}

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

/** Append an event to the log with the next global id. */
export function pushEvent(state: WorkspaceState, event: Omit<BranchEventRecord, "id">): number {
  const id = state.metadata.nextEventId;
  state.metadata.nextEventId += 1;
  state.branchEvents.push({ ...event, id });
  return id;
}

export function getBranchOrThrow(state: WorkspaceState, branchId: string): BranchRecord {
  const row = state.branches.find((b) => b.id === branchId);
  if (!row) throw notFound("Branch", branchId);
  return row;
}

export function findBranchByIdOrCode(
  state: WorkspaceState,
  idOrCode: string,
): BranchRecord | undefined {
  return (
    state.branches.find((b) => b.id === idOrCode) ??
    state.branches.find((b) => b.code === idOrCode.toUpperCase())
  );
}

export function getBetOrThrow(state: WorkspaceState, betId: string): BetRecord {
  const row = state.bets.find((b) => b.id === betId);
  if (!row) throw notFound("Ticket", betId);
  return row;
}

export function isOpenTicket(bet: BetRecord): boolean {
  return bet.result === "PENDING" && bet.cancelledAt === null;
}

export function pendingTicketOf(state: WorkspaceState, branchId: string): BetRecord | undefined {
  return state.bets.find((b) => b.branchId === branchId && isOpenTicket(b));
}

export function toBranchState(row: BranchRecord): BranchState {
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
export function automaticProfileCounts(state: WorkspaceState): ProfileCounts {
  const counts = emptyProfileCounts();
  for (const b of state.branches) if (b.birthReason !== "ROOT") counts[b.profile] += 1;
  return counts;
}

/** Local calendar day (YYYY-MM-DD) of a date, in the server's timezone. */
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Strategy stamp recorded on every new branch and ticket. */
export function strategyStamp(state: WorkspaceState): {
  strategyVersion: string;
  strategyRevision: number;
} {
  return {
    strategyVersion: state.settings.strategyVersion,
    strategyRevision: state.metadata.strategyRevision,
  };
}
