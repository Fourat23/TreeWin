"use server";

import type { CreateTicketInput, UpdateTicketDetailsInput } from "@/domain/bets/tickets";
import type { SettlementPlan } from "@/domain/strategy/engine";
import { listPlayableBranches } from "../queries/branches";
import type { PlayableBranchDTO } from "../queries/dto";
import {
  cancelPendingTicket,
  checkTicketConflicts,
  createTicket,
  previewSettlement,
  settleTicket,
  updateTicketDetails,
  type SettleTicketInput,
  type TicketConflicts,
} from "../services/bet-service";
import { linkCandidateToBet } from "../services/candidate-service";
import { getBranchOrThrow } from "../services/internal";
import type { ActionResult } from "./result";
import { mutateAction, readAction } from "./workspace-op";

export async function listPlayableBranchesAction(
  workspace: string,
): Promise<ActionResult<PlayableBranchDTO[]>> {
  return readAction(workspace, (state) => listPlayableBranches(state));
}

export async function checkTicketConflictsAction(
  workspace: string,
  input: { eventName: string; eventDate: string; branchId?: string; excludeBetId?: string },
): Promise<ActionResult<TicketConflicts>> {
  return readAction(workspace, (state) => checkTicketConflicts(state, input, new Date()));
}

export async function createTicketAction(
  workspace: string,
  input: CreateTicketInput & { candidateId?: string },
): Promise<
  ActionResult<{ betId: string; roundNumber: number; warnings: string[]; label: string }>
> {
  const { candidateId, ...ticket } = input;
  return mutateAction(
    workspace,
    (state, ctx) => {
      const { bet, warnings } = createTicket(state, ticket, ctx);
      if (candidateId) linkCandidateToBet(state, candidateId, bet.id, ctx);
      const code = getBranchOrThrow(state, bet.branchId).code;
      return {
        betId: bet.id,
        roundNumber: bet.roundNumber,
        warnings,
        label: `Created ticket ${code}·${state.settings.roundShortLabel}${bet.roundNumber} (${bet.eventName})`,
      };
    },
    (r) => r.label,
  );
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
  workspace: string,
  input: SettleTicketInput,
): Promise<ActionResult<SettlementPreviewData>> {
  return readAction(workspace, (state) => {
    const { bet, branch, plan } = previewSettlement(state, input);
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
  workspace: string,
  input: SettleTicketInput,
): Promise<
  ActionResult<{
    branchCode: string;
    childCodes: string[];
    died: boolean;
    matured: boolean;
    label: string;
  }>
> {
  return mutateAction(
    workspace,
    (state, ctx) => {
      const outcome = settleTicket(state, input, ctx);
      return {
        branchCode: outcome.branch.code,
        childCodes: outcome.plan.children.map((c) => c.code),
        died: outcome.plan.died,
        matured: outcome.plan.matured,
        label: `Settled ${outcome.branch.code}·${state.settings.roundShortLabel}${outcome.bet.roundNumber} as ${outcome.plan.result}`,
      };
    },
    (r) => r.label,
  );
}

export async function cancelTicketAction(
  workspace: string,
  input: { betId: string; reason: string },
): Promise<ActionResult<{ label: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => {
      const bet = cancelPendingTicket(state, input, ctx);
      const code = getBranchOrThrow(state, bet.branchId).code;
      return {
        label: `Cancelled pending ticket ${code}·${state.settings.roundShortLabel}${bet.roundNumber}`,
      };
    },
    (r) => r.label,
  );
}

export async function updateTicketAction(
  workspace: string,
  input: UpdateTicketDetailsInput & { override?: { confirmed: true; reason: string } },
): Promise<ActionResult<{ label: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => {
      const bet = updateTicketDetails(state, input, ctx);
      const code = getBranchOrThrow(state, bet.branchId).code;
      return { label: `Edited ticket ${code}·${state.settings.roundShortLabel}${bet.roundNumber}` };
    },
    (r) => r.label,
  );
}
