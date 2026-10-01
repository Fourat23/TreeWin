"use server";

import type { Profile } from "@/domain/types";
import {
  adjustBranchCapital,
  changeBranchProfile,
  createRootBranch,
  setBranchPaused,
  transferToBank,
  updateBranchNotes,
  type CreateRootBranchInput,
} from "../services/branch-service";
import { moneyFormatter } from "../services/internal";
import type { ActionResult } from "./result";
import { mutateAction } from "./workspace-op";

export async function createRootBranchAction(
  workspace: string,
  input: CreateRootBranchInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => {
      const branch = createRootBranch(state, input, ctx);
      return {
        id: branch.id,
        code: branch.code,
        label: `Created root branch ${branch.code} (${moneyFormatter(state.settings)(branch.birthCapitalCents)})`,
      };
    },
    (r) => r.label,
  );
}

export async function setBranchPausedAction(
  workspace: string,
  input: { branchId: string; paused: boolean; reason?: string },
): Promise<ActionResult<{ code: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => ({ code: setBranchPaused(state, input, ctx).code }),
    (r) => `${input.paused ? "Paused" : "Resumed"} ${r.code}`,
  );
}

export async function changeBranchProfileAction(
  workspace: string,
  input: { branchId: string; profile: Profile; reason: string; applyProfileCap?: boolean },
): Promise<ActionResult<{ code: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => ({ code: changeBranchProfile(state, input, ctx).code }),
    (r) => `Changed ${r.code} profile to ${input.profile}`,
  );
}

export async function adjustBranchCapitalAction(
  workspace: string,
  input: { branchId: string; deltaCents: number; reason: string },
): Promise<ActionResult<{ code: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => ({ code: adjustBranchCapital(state, input, ctx).code }),
    (r) => `Manual capital adjustment on ${r.code}`,
  );
}

export async function transferToBankAction(
  workspace: string,
  input: { branchId: string; amountCents: number; reason: string },
): Promise<ActionResult<{ code: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => ({ code: transferToBank(state, input, ctx).code }),
    (r) => `Manual BANK transfer from ${r.code}`,
  );
}

export async function updateBranchNotesAction(
  workspace: string,
  input: { branchId: string; notes: string },
): Promise<ActionResult> {
  return mutateAction(workspace, (state, ctx) => updateBranchNotes(state, input, ctx));
}
