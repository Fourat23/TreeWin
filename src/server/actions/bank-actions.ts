"use server";

import type { BankDestination } from "@/domain/types";
import {
  markWithdrawn,
  setBankDestination,
  setWithdrawalDate,
  undoWithdrawn,
} from "../services/bank-service";
import type { ActionResult } from "./result";
import { mutateAction } from "./workspace-op";

export async function markWithdrawnAction(
  workspace: string,
  input: { transactionIds: string[]; withdrawnOn?: string; destination?: BankDestination },
): Promise<ActionResult<number>> {
  return mutateAction(
    workspace,
    (state, ctx) => markWithdrawn(state, input, ctx),
    (n) =>
      `Marked ${n} BANK entr${n === 1 ? "y" : "ies"} as withdrawn${
        input.withdrawnOn ? ` on ${input.withdrawnOn}` : ""
      }`,
  );
}

export async function undoWithdrawnAction(
  workspace: string,
  input: { transactionIds: string[] },
): Promise<ActionResult<number>> {
  return mutateAction(
    workspace,
    (state) => undoWithdrawn(state, input),
    (n) => `Undid withdrawal of ${n} BANK entr${n === 1 ? "y" : "ies"}`,
  );
}

export async function setBankDestinationAction(
  workspace: string,
  input: { transactionIds: string[]; destination: BankDestination },
): Promise<ActionResult<number>> {
  return mutateAction(
    workspace,
    (state) => setBankDestination(state, input),
    (n) => `Set destination ${input.destination} on ${n} BANK entr${n === 1 ? "y" : "ies"}`,
  );
}

export async function setWithdrawalDateAction(
  workspace: string,
  input: { transactionIds: string[]; withdrawnOn: string },
): Promise<ActionResult<number>> {
  return mutateAction(
    workspace,
    (state, ctx) => setWithdrawalDate(state, input, ctx),
    (n) =>
      `Changed the withdrawal date of ${n} BANK entr${n === 1 ? "y" : "ies"} to ${input.withdrawnOn}`,
  );
}
