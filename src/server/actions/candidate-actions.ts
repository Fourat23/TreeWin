"use server";

import {
  createCandidate,
  updateCandidate,
  type CandidateInput,
} from "../services/candidate-service";
import type { ActionResult } from "./result";
import { mutateAction } from "./workspace-op";

export async function createCandidateAction(
  workspace: string,
  input: CandidateInput,
): Promise<ActionResult<{ id: string }>> {
  return mutateAction(workspace, (state, ctx) => ({ id: createCandidate(state, input, ctx).id }));
}

export async function updateCandidateAction(
  workspace: string,
  input: Partial<CandidateInput> & { id: string },
): Promise<ActionResult> {
  return mutateAction(workspace, (state, ctx) => void updateCandidate(state, input, ctx));
}
