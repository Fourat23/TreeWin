import { DomainError, type DomainErrorCode } from "../services/errors";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: DomainErrorCode | "UNEXPECTED";
      message: string;
      details?: Record<string, unknown>;
    };

/** Run a service call and convert business errors into a serializable result. */
export function runAction<T>(fn: () => T): ActionResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, code: error.code, message: error.message, details: error.details };
    }
    console.error("[celltree] unexpected action error", error);
    return {
      ok: false,
      code: "UNEXPECTED",
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}
