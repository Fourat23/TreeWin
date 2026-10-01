import { z } from "zod";
import { BANK_DESTINATIONS } from "@/domain/types";
import type { BankTransactionRecord, WorkspaceState } from "../state/schema";
import { DomainError, notFound } from "./errors";
import { localDay, parseInput, type OpContext } from "./internal";

/**
 * BANK bookkeeping. Money secured to the BANK has left the branch ecosystem for good:
 *   SECURED    — secured by the strategy, possibly still sitting on the Winamax balance
 *   WITHDRAWN  — actually withdrawn from Winamax (date recorded)
 * Neither status can ever send money back to a branch; these actions only describe where the
 * money physically is.
 */

const idsSchema = z
  .array(z.string().min(1))
  .min(1, { error: "Select at least one BANK entry" })
  .max(10_000);

function pick(state: WorkspaceState, ids: readonly string[]): BankTransactionRecord[] {
  return ids.map((id) => {
    const tx = state.bankTransactions.find((t) => t.id === id);
    if (!tx) throw notFound("BANK transaction", id);
    return tx;
  });
}

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Withdrawal date must be YYYY-MM-DD" })
  .refine(isCalendarDay, { error: "Invalid withdrawal date" });

export const markWithdrawnSchema = z.object({
  transactionIds: idsSchema,
  /** Local day of the withdrawal (YYYY-MM-DD). Defaults to today; never in the future. */
  withdrawnOn: daySchema.optional(),
  destination: z.enum(BANK_DESTINATIONS).optional(),
});

/**
 * Timestamp stored in `withdrawnAt` for a withdrawal day: now for today, local noon for a past
 * day, never before the money was secured. Future days are refused (no scheduled withdrawals).
 */
function withdrawalTimestamp(
  day: string | undefined,
  rows: readonly BankTransactionRecord[],
  now: Date,
): (tx: BankTransactionRecord) => number {
  const today = localDay(now);
  const chosen = day ?? today;
  if (chosen > today) {
    throw new DomainError("VALIDATION", "The withdrawal date cannot be in the future");
  }
  const earliest = rows.reduce((min, t) => Math.min(min, t.createdAt), Infinity);
  if (rows.length > 0 && chosen < localDay(new Date(earliest))) {
    throw new DomainError(
      "VALIDATION",
      "The withdrawal date cannot be before the money was secured",
    );
  }
  const at = chosen === today ? now.getTime() : localNoon(chosen);
  return (tx) => Math.max(at, tx.createdAt);
}

export function markWithdrawn(
  state: WorkspaceState,
  input: z.input<typeof markWithdrawnSchema>,
  ctx: OpContext,
): number {
  const data = parseInput(markWithdrawnSchema, input);
  const rows = pick(state, data.transactionIds).filter((t) => t.status !== "WITHDRAWN");
  if (rows.length === 0) {
    throw new DomainError("INVALID_STATE", "Every selected entry is already withdrawn");
  }
  const stampFor = withdrawalTimestamp(data.withdrawnOn, rows, ctx.now);
  for (const tx of rows) {
    tx.status = "WITHDRAWN";
    tx.withdrawnAt = stampFor(tx);
    if (data.destination) tx.destination = data.destination;
  }
  return rows.length;
}

export const setWithdrawalDateSchema = z.object({
  transactionIds: idsSchema,
  withdrawnOn: daySchema,
});

/** Correct the withdrawal date of WITHDRAWN entries (audited and undoable like any change). */
export function setWithdrawalDate(
  state: WorkspaceState,
  input: z.input<typeof setWithdrawalDateSchema>,
  ctx: OpContext,
): number {
  const data = parseInput(setWithdrawalDateSchema, input);
  const rows = pick(state, data.transactionIds);
  if (rows.some((t) => t.status !== "WITHDRAWN")) {
    throw new DomainError("INVALID_STATE", "Only withdrawn entries have a withdrawal date");
  }
  const stampFor = withdrawalTimestamp(data.withdrawnOn, rows, ctx.now);
  for (const tx of rows) tx.withdrawnAt = stampFor(tx);
  return rows.length;
}

export const undoWithdrawnSchema = z.object({ transactionIds: idsSchema });

/** Correct a withdrawal recorded by mistake: the money is SECURED again (still never playable). */
export function undoWithdrawn(
  state: WorkspaceState,
  input: z.input<typeof undoWithdrawnSchema>,
): number {
  const data = parseInput(undoWithdrawnSchema, input);
  let changed = 0;
  for (const tx of pick(state, data.transactionIds)) {
    if (tx.status !== "WITHDRAWN") continue;
    tx.status = "SECURED";
    tx.withdrawnAt = null;
    changed += 1;
  }
  if (changed === 0)
    throw new DomainError("INVALID_STATE", "None of the selected entries is withdrawn");
  return changed;
}

export const setDestinationSchema = z.object({
  transactionIds: idsSchema,
  destination: z.enum(BANK_DESTINATIONS),
});

export function setBankDestination(
  state: WorkspaceState,
  input: z.input<typeof setDestinationSchema>,
): number {
  const data = parseInput(setDestinationSchema, input);
  const rows = pick(state, data.transactionIds);
  for (const tx of rows) tx.destination = data.destination;
  return rows.length;
}

export interface BankStatusTotals {
  securedCents: number;
  withdrawnCents: number;
  /** Secured but still on the Winamax balance (status SECURED). */
  awaitingWithdrawalCents: number;
}

/** TOTAL SECURED = everything that ever reached the BANK (withdrawn or not). */
export function bankStatusTotals(
  state: Pick<WorkspaceState, "bankTransactions">,
): BankStatusTotals {
  let securedCents = 0;
  let withdrawnCents = 0;
  for (const tx of state.bankTransactions) {
    securedCents += tx.amountCents;
    if (tx.status === "WITHDRAWN") withdrawnCents += tx.amountCents;
  }
  return { securedCents, withdrawnCents, awaitingWithdrawalCents: securedCents - withdrawnCents };
}

function isCalendarDay(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function localNoon(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getTime();
}
