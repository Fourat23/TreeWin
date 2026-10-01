"use server";

import { revalidatePath } from "next/cache";
import type { CreateTicketInput, UpdateTicketDetailsInput } from "@/domain/bets/tickets";
import type { SettlementPlan } from "@/domain/strategy/engine";
import { getDb } from "../db";
import type { PlayableBranchDTO } from "../queries/dto";
import { listPlayableBranches } from "../queries/branches";
import {
  cancelPendingTicket,
  checkTicketConflicts,
  createTicket,
  previewSettlement,
  revertSettlement,
  settleTicket,
  updateTicketDetails,
  type SettleTicketInput,
  type TicketConflicts,
} from "../services/bet-service";
import { linkCandidateToBet } from "../services/candidate-service";
import { runAction, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/", "layout");
}

export async function listPlayableBranchesAction(): Promise<ActionResult<PlayableBranchDTO[]>> {
  return runAction(() => listPlayableBranches(getDb()));
}

export async function checkTicketConflictsAction(input: {
  eventName: string;
  eventDate: string;
  branchId?: string;
}): Promise<ActionResult<TicketConflicts>> {
  return runAction(() => checkTicketConflicts(getDb(), input));
}

export async function createTicketAction(
  input: CreateTicketInput & { candidateId?: string },
): Promise<ActionResult<{ betId: string; roundNumber: number; warnings: string[] }>> {
  const { candidateId, ...ticket } = input;
  const result = runAction(() => {
    const db = getDb();
    const { bet, warnings } = createTicket(db, ticket);
    if (candidateId) linkCandidateToBet(db, candidateId, bet.id);
    return { betId: bet.id, roundNumber: bet.roundNumber, warnings };
  });
  if (result.ok) refresh();
  return result;
}

export interface SettlementPreviewData {
  branchCode: string;
  eventName: string;
  selection: string;
  capitalBeforeCents: number;
  stakeCents: number;
  oddsBp: number;
  roundNumber: number;
  plan: SettlementPlan;
}

export async function previewSettlementAction(
  input: SettleTicketInput,
): Promise<ActionResult<SettlementPreviewData>> {
  return runAction(() => {
    const { bet, branch, plan } = previewSettlement(getDb(), input);
    return {
      branchCode: branch.code,
      eventName: bet.eventName,
      selection: bet.selection,
      capitalBeforeCents: branch.currentCapitalCents,
      stakeCents: bet.stakeCents,
      oddsBp: bet.oddsBp,
      roundNumber: bet.roundNumber,
      plan,
    };
  });
}

export async function settleTicketAction(
  input: SettleTicketInput,
): Promise<
  ActionResult<{ branchCode: string; childCodes: string[]; died: boolean; matured: boolean }>
> {
  const result = runAction(() => {
    const outcome = settleTicket(getDb(), input);
    return {
      branchCode: outcome.branch.code,
      childCodes: outcome.plan.children.map((c) => c.code),
      died: outcome.plan.died,
      matured: outcome.plan.matured,
    };
  });
  if (result.ok) refresh();
  return result;
}

export async function cancelTicketAction(input: {
  betId: string;
  reason: string;
}): Promise<ActionResult> {
  const result = runAction(() => void cancelPendingTicket(getDb(), input));
  if (result.ok) refresh();
  return result;
}

export async function updateTicketAction(
  input: UpdateTicketDetailsInput & { override?: { confirmed: true; reason: string } },
): Promise<ActionResult> {
  const result = runAction(() => void updateTicketDetails(getDb(), input));
  if (result.ok) refresh();
  return result;
}

export async function revertSettlementAction(input: {
  betId: string;
  reason: string;
}): Promise<ActionResult> {
  const result = runAction(() => void revertSettlement(getDb(), input));
  if (result.ok) refresh();
  return result;
}
