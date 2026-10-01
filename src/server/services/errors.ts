export type DomainErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "INVALID_STATE"
  | "PENDING_EXISTS"
  | "SAME_EVENT_CONFLICT"
  | "LIMIT_REACHED"
  | "NOT_REVERTIBLE"
  | "IMPORT_REJECTED";

/** Business-rule violation surfaced to the UI with a stable code. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function notFound(entity: string, id: string): DomainError {
  return new DomainError("NOT_FOUND", `${entity} ${id} not found`);
}
