"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "../db";
import {
  archiveCandidate,
  createCandidate,
  updateCandidate,
  type CandidateInput,
} from "../services/candidate-service";
import { runAction, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/candidates");
  revalidatePath("/analytics");
}

export async function createCandidateAction(
  input: CandidateInput,
): Promise<ActionResult<{ id: string }>> {
  const result = runAction(() => ({ id: createCandidate(getDb(), input).id }));
  if (result.ok) refresh();
  return result;
}

export async function updateCandidateAction(
  input: Partial<CandidateInput> & { id: string },
): Promise<ActionResult> {
  const result = runAction(() => void updateCandidate(getDb(), input));
  if (result.ok) refresh();
  return result;
}

export async function archiveCandidateAction(id: string): Promise<ActionResult> {
  const result = runAction(() => archiveCandidate(getDb(), id));
  if (result.ok) refresh();
  return result;
}
