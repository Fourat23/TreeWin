import { z } from "zod";
import { BANK_DESTINATIONS } from "@/domain/types";
import type { BankTransactionRecord, WorkspaceState } from "../state/schema";
import { DomainError, notFound } from "./errors";
import { parseInput, type OpContext } from "./internal";

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

export const markWithdrawnSchema = z.object({
  transactionIds: idsSchema,
  /** Withdrawal day (YYYY-MM-DD); defaults to now. */
  withdrawnOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  destination: z.enum(BANK_DESTINATIONS).optional(),
});

export function markWithdrawn(
  state: WorkspaceState,
  input: z.input<typeof markWithdrawnSchema>,
  ctx: OpContext,
): number {
  const data = parseInput(markWithdrawnSchema, input);
  const at = data.withdrawnOn ? localNoon(data.withdrawnOn) : ctx.now.getTime();
  const rows = pick(state, data.transactionIds);
  if (rows.some((t) => at < t.createdAt - 86_400_000)) {
    throw new DomainError(
      "VALIDATION",
      "The withdrawal date cannot be before the money was secured",
    );
  }
  let changed = 0;
  for (const tx of rows) {
    if (tx.status === "WITHDRAWN") continue;
    tx.status = "WITHDRAWN";
    tx.withdrawnAt = Math.max(at, tx.createdAt);
    if (data.destination) tx.destination = data.destination;
    changed += 1;
  }
  if (changed === 0)
    throw new DomainError("INVALID_STATE", "Every selected entry is already withdrawn");
  return changed;
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

function localNoon(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getTime();
}
