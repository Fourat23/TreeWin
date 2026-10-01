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
): Promise<ActionResult<{ id: string; eventName: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => {
      const candidate = createCandidate(state, input, ctx);
      return { id: candidate.id, eventName: candidate.eventName };
    },
    (r) => `Added candidate ${r.eventName}`,
  );
}

export async function updateCandidateAction(
  workspace: string,
  input: Partial<CandidateInput> & { id: string },
): Promise<ActionResult<{ eventName: string }>> {
  return mutateAction(
    workspace,
    (state, ctx) => ({ eventName: updateCandidate(state, input, ctx).eventName }),
    (r) => `Edited candidate ${r.eventName}`,
  );
}
