import { expect } from "vitest";
import type { CreateTicketInput } from "@/domain/bets/tickets";
import { suggestedStakeCents } from "@/domain/strategy/engine";
import type { Workspace } from "@/domain/types";
import { createEmptyState, findIntegrityProblems } from "../state/integrity";
import type { WorkspaceState } from "../state/schema";
import { createTicket, settleTicket } from "./bet-service";
import { DomainError } from "./errors";
import type { OpContext } from "./internal";

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

/**
 * In-memory workspace for service tests: a state plus a clock that advances one minute per
 * operation (so event order and timestamps are deterministic).
 */
export function workspaceHarness(workspace: Workspace = "REAL") {
  let clock = Date.parse("2026-10-01T08:00:00.000Z");
  const state: WorkspaceState = createEmptyState(workspace, new Date(clock));
  const ctx = (): OpContext => ({ workspace, now: new Date((clock += 60_000)) });

  const branch = (code: string) => {
    const row = state.branches.find((b) => b.code === code);
    if (!row) throw new Error(`branch ${code} missing`);
    return row;
  };
  const events = (branchId: string) =>
    state.branchEvents.filter((e) => e.branchId === branchId).sort((a, b) => a.id - b.id);
  const bankTotal = () => state.bankTransactions.reduce((s, t) => s + t.amountCents, 0);
  /** Play a full-stake round (V1 rule) and settle it. */
  const play = (branchId: string, oddsBp: number, result: "WON" | "LOST" | "VOID") => {
    const row = state.branches.find((b) => b.id === branchId);
    if (!row) throw new Error("missing branch");
    const { bet } = createTicket(
      state,
      ticketInput(branchId, suggestedStakeCents(row), oddsBp),
      ctx(),
    );
    return settleTicket(state, { betId: bet.id, result }, ctx());
  };
  const expectValid = () => expect(findIntegrityProblems(state, workspace)).toEqual([]);

  return { state, ctx, branch, events, bankTotal, play, expectValid };
}

export function expectDomainError(fn: () => unknown, code: DomainError["code"]): DomainError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return error as DomainError;
  }
  throw new Error(`Expected DomainError ${code}`);
}
