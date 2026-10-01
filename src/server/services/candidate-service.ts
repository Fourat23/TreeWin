import { z } from "zod";
import { looksLikeMultiMatch } from "@/domain/bets/tickets";
import { BET_RESULTS, CANDIDATE_STATUSES, CHECKLIST_ITEMS, TRISTATE_VALUES } from "@/domain/types";
import type { CandidateRecord, WorkspaceState } from "../state/schema";
import { DomainError, notFound } from "./errors";
import { newId, parseInput, type OpContext } from "./internal";

/**
 * Shadow portfolio: matches analysed but not played, to build statistics without staking.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const candidateInputSchema = z.object({
  eventDate: z.string().regex(ISO_DATE, { error: "Event date is required" }),
  eventTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  sport: z.string().trim().min(1, { error: "Sport is required" }).max(60),
  competition: z.string().trim().min(1, { error: "Competition is required" }).max(120),
  eventName: z
    .string()
    .trim()
    .min(3, { error: "Match is required" })
    .max(160)
    .refine((v) => !looksLikeMultiMatch(v), { error: "One candidate = one single match" }),
  marketName: z.string().trim().min(1, { error: "Market is required" }).max(120),
  selection: z.string().trim().min(1, { error: "Selection is required" }).max(120),
  oddsObservedBp: z.int().min(10_100, { error: "Odds must be at least 1.01" }).max(10_000_000),
  closingOddsBp: z.int().min(10_100).max(10_000_000).nullable().optional(),
  protocolStatus: z.enum(CANDIDATE_STATUSES),
  result: z.enum(BET_RESULTS).default("PENDING"),
  checklist: z.partialRecord(z.enum(CHECKLIST_ITEMS), z.enum(TRISTATE_VALUES)).optional(),
  notes: z.string().trim().max(2_000).optional(),
});
export type CandidateInput = z.input<typeof candidateInputSchema>;

export function getCandidateOrThrow(state: WorkspaceState, id: string): CandidateRecord {
  const row = state.candidates.find((c) => c.id === id);
  if (!row) throw notFound("Candidate", id);
  return row;
}

export function createCandidate(
  state: WorkspaceState,
  input: CandidateInput,
  ctx: OpContext,
): CandidateRecord {
  const data = parseInput(candidateInputSchema, input);
  const now = ctx.now.getTime();
  const record: CandidateRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    eventDate: data.eventDate,
    eventTime: data.eventTime ?? null,
    sport: data.sport,
    competition: data.competition,
    eventName: data.eventName,
    marketName: data.marketName,
    selection: data.selection,
    oddsObservedBp: data.oddsObservedBp,
    closingOddsBp: data.closingOddsBp ?? null,
    protocolStatus: data.protocolStatus,
    result: data.result,
    checklist: data.checklist ?? null,
    notes: data.notes ?? null,
    convertedBetId: null,
    archivedAt: null,
  };
  state.candidates.push(record);
  return record;
}

export const updateCandidateSchema = candidateInputSchema
  .partial()
  .extend({ id: z.string().min(1) });

export function updateCandidate(
  state: WorkspaceState,
  input: z.input<typeof updateCandidateSchema>,
  ctx: OpContext,
): CandidateRecord {
  const { id, ...data } = parseInput(updateCandidateSchema, input);
  const row = getCandidateOrThrow(state, id);
  if (row.archivedAt) throw new DomainError("INVALID_STATE", "Archived candidates are read-only");
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) (row as Record<string, unknown>)[key] = value;
  }
  row.updatedAt = ctx.now.getTime();
  return row;
}

/** Soft delete: the candidate stays in the file for statistics history. */
export function archiveCandidate(state: WorkspaceState, id: string, ctx: OpContext): void {
  const row = getCandidateOrThrow(state, id);
  row.archivedAt = ctx.now.getTime();
  row.updatedAt = row.archivedAt;
}

/** Permanent deletion of a candidate (typed confirmation is checked by the caller). */
export function purgeCandidate(state: WorkspaceState, id: string): CandidateRecord {
  const row = getCandidateOrThrow(state, id);
  state.candidates = state.candidates.filter((c) => c.id !== id);
  return row;
}

export function linkCandidateToBet(
  state: WorkspaceState,
  candidateId: string,
  betId: string,
  ctx: OpContext,
): void {
  const row = getCandidateOrThrow(state, candidateId);
  row.convertedBetId = betId;
  row.updatedAt = ctx.now.getTime();
}

export function listCandidates(state: WorkspaceState): CandidateRecord[] {
  return state.candidates
    .filter((c) => c.archivedAt === null)
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt - a.createdAt);
}
