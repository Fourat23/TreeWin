import { DomainError, type DomainErrorCode } from "../services/errors";
import { StateIntegrityError } from "../state/integrity";
import { StateLoadError } from "../state/repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: DomainErrorCode | "UNEXPECTED";
      message: string;
      details?: Record<string, unknown>;
    };

/** Convert business / persistence errors into a serializable result. */
export function toFailure(error: unknown): Extract<ActionResult<never>, { ok: false }> {
  if (error instanceof DomainError) {
    return { ok: false, code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof StateIntegrityError || error instanceof StateLoadError) {
    return {
      ok: false,
      code: "STATE_INVALID",
      message: `${error.message}. Nothing was written.`,
      details: { problems: error.problems },
    };
  }
  console.error("[celltree] unexpected action error", error);
  return {
    ok: false,
    code: "UNEXPECTED",
    message: error instanceof Error ? error.message : "Unexpected error",
  };
}

/** Run a service call and convert business errors into a serializable result. */
export async function runAction<T>(fn: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return toFailure(error);
  }
}
