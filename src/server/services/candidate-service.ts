import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { looksLikeMultiMatch } from "@/domain/bets/tickets";
import { BET_RESULTS, CANDIDATE_STATUSES, CHECKLIST_ITEMS, TRISTATE_VALUES } from "@/domain/types";
import type { Db, DbOrTx } from "../db/client";
import { candidates, type CandidateRow } from "../db/schema";
import { DomainError, notFound } from "./errors";
import { newId, parseInput } from "./internal";

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

export function createCandidate(db: Db, input: CandidateInput, now = new Date()): CandidateRow {
  const data = parseInput(candidateInputSchema, input);
  const id = newId();
  db.insert(candidates)
    .values({
      id,
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
    })
    .run();
  return getCandidateOrThrow(db, id);
}

export function getCandidateOrThrow(db: DbOrTx, id: string): CandidateRow {
  const row = db.select().from(candidates).where(eq(candidates.id, id)).get();
  if (!row) throw notFound("Candidate", id);
  return row;
}

export const updateCandidateSchema = candidateInputSchema
  .partial()
  .extend({ id: z.string().min(1) });

export function updateCandidate(
  db: Db,
  input: z.input<typeof updateCandidateSchema>,
  now = new Date(),
): CandidateRow {
  const { id, ...data } = parseInput(updateCandidateSchema, input);
  const row = getCandidateOrThrow(db, id);
  if (row.archivedAt) throw new DomainError("INVALID_STATE", "Archived candidates are read-only");
  const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  db.update(candidates)
    .set({ ...patch, updatedAt: now })
    .where(eq(candidates.id, id))
    .run();
  return getCandidateOrThrow(db, id);
}

/** Soft delete: the row stays in the database for statistics history. */
export function archiveCandidate(db: Db, id: string, now = new Date()): void {
  getCandidateOrThrow(db, id);
  db.update(candidates).set({ archivedAt: now, updatedAt: now }).where(eq(candidates.id, id)).run();
}

export function linkCandidateToBet(
  db: DbOrTx,
  candidateId: string,
  betId: string,
  now = new Date(),
) {
  db.update(candidates)
    .set({ convertedBetId: betId, updatedAt: now })
    .where(eq(candidates.id, candidateId))
    .run();
}

export function listCandidates(db: DbOrTx): CandidateRow[] {
  return db
    .select()
    .from(candidates)
    .where(isNull(candidates.archivedAt))
    .orderBy(desc(candidates.eventDate), desc(candidates.createdAt))
    .all();
}
