"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "../db";
import {
  adjustBranchCapital,
  changeBranchProfile,
  createRootBranch,
  setBranchPaused,
  transferToBank,
  updateBranchNotes,
  type CreateRootBranchInput,
} from "../services/branch-service";
import { runAction, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/", "layout");
}

export async function createRootBranchAction(
  input: CreateRootBranchInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  const result = runAction(() => {
    const branch = createRootBranch(getDb(), input);
    return { id: branch.id, code: branch.code };
  });
  if (result.ok) refresh();
  return result;
}

export async function setBranchPausedAction(input: {
  branchId: string;
  paused: boolean;
  reason?: string;
}): Promise<ActionResult> {
  const result = runAction(() => void setBranchPaused(getDb(), input));
  if (result.ok) refresh();
  return result;
}

export async function changeBranchProfileAction(input: {
  branchId: string;
  profile: "HARVEST" | "BALANCED" | "GROWTH";
  reason: string;
  applyProfileCap?: boolean;
}): Promise<ActionResult> {
  const result = runAction(() => void changeBranchProfile(getDb(), input));
  if (result.ok) refresh();
  return result;
}

export async function adjustBranchCapitalAction(input: {
  branchId: string;
  deltaCents: number;
  reason: string;
}): Promise<ActionResult> {
  const result = runAction(() => void adjustBranchCapital(getDb(), input));
  if (result.ok) refresh();
  return result;
}

export async function transferToBankAction(input: {
  branchId: string;
  amountCents: number;
  reason: string;
}): Promise<ActionResult> {
  const result = runAction(() => void transferToBank(getDb(), input));
  if (result.ok) refresh();
  return result;
}

export async function updateBranchNotesAction(input: {
  branchId: string;
  notes: string;
}): Promise<ActionResult> {
  const result = runAction(() => updateBranchNotes(getDb(), input));
  if (result.ok) refresh();
  return result;
}
