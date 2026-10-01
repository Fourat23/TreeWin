import type { CreateTicketInput } from "@/domain/bets/tickets";
import { createTestDatabase } from "../db/client";

export function setupTestDb() {
  return createTestDatabase();
}

let counter = 0;

/** Minimal valid ticket for a branch; every call targets a different match by default. */
export function ticketInput(
  branchId: string,
  stakeCents: number,
  oddsBp: number,
  overrides: Partial<CreateTicketInput> = {},
): CreateTicketInput {
  counter += 1;
  return {
    branchId,
    sport: "Football",
    competition: "Ligue 1",
    eventName: `Home ${counter} - Away ${counter}`,
    marketName: "Vainqueur du match",
    selection: `Home ${counter}`,
    eventDate: "2026-10-04",
    oddsBp,
    stakeCents,
    checklist: { singleMatch: "TRUE" },
    ...overrides,
  };
}
