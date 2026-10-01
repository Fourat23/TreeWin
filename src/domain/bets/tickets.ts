import { z } from "zod";
import { BP_SCALE, mulDivRound, type Bp, type OddsBp } from "../money";
import { CHECKLIST_ITEMS, PROTOCOL_STATUSES, TRISTATE_VALUES, type Checklist } from "../types";

/**
 * Ticket rules. One ticket = one round = ONE single match on Winamax. Never a combo.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Separators that indicate several matches in one ticket ("A - B + C - D"). */
const MULTI_MATCH_SEPARATORS = [" + ", " ; ", ";", " | ", " && "];
const MATCH_SEPARATOR_RE = /\s(?:-|–|—|vs\.?|v)\s/gi;

/** Heuristic guard: true when the event name looks like a multi-match combo. */
export function looksLikeMultiMatch(eventName: string): boolean {
  if (MULTI_MATCH_SEPARATORS.some((sep) => eventName.includes(sep))) return true;
  const separators = eventName.match(MATCH_SEPARATOR_RE);
  return (separators?.length ?? 0) > 1;
}

/**
 * Normalised identity of a match, used to detect several branches on the same event:
 * accents/case/punctuation removed, "vs"/"–" unified, plus the calendar day.
 */
export function eventKey(eventName: string, eventDate: string): string {
  const normalized = eventName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(MATCH_SEPARATOR_RE, " - ")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${eventDate.slice(0, 10)}|${normalized}`;
}

/**
 * Closing Line Value, in basis points: oddsTaken / closingOdds − 1.
 *
 * +500 bp (+5 %) means the ticket was taken at a price 5 % better than the closing price,
 * i.e. the market moved towards the selection after the bet. This "price ratio" definition
 * is the most common one; an alternative is the difference of implied probabilities
 * (1/closing − 1/taken), which gives slightly different magnitudes. Margin is not removed:
 * Winamax closing odds include the bookmaker overround, so CLV is a relative indicator.
 */
export function clvBp(oddsBp: OddsBp, closingOddsBp: OddsBp | null | undefined): Bp | null {
  if (!closingOddsBp || closingOddsBp <= 0) return null;
  return mulDivRound(oddsBp, BP_SCALE, closingOddsBp) - BP_SCALE;
}

export interface OddsBucket {
  id: string;
  label: string;
  /** Inclusive lower bound (bp). */
  min: number;
  /** Exclusive upper bound (bp), null = open. */
  max: number | null;
}

/** Odds buckets used by ticket analytics (Winamax quotes 2 decimals). */
export const ODDS_BUCKETS: readonly OddsBucket[] = [
  { id: "lt115", label: "< 1.15", min: 0, max: 11_500 },
  { id: "115-119", label: "1.15–1.19", min: 11_500, max: 12_000 },
  { id: "120-122", label: "1.20–1.22", min: 12_000, max: 12_300 },
  { id: "123-125", label: "1.23–1.25", min: 12_300, max: 12_600 },
  { id: "126-128", label: "1.26–1.28", min: 12_600, max: 12_900 },
  { id: "129-130", label: "1.29–1.30", min: 12_900, max: 13_001 },
  { id: "gt130", label: "> 1.30", min: 13_001, max: null },
];

export function oddsBucketOf(oddsBp: OddsBp): OddsBucket {
  const bucket = ODDS_BUCKETS.find((b) => oddsBp >= b.min && (b.max === null || oddsBp < b.max));
  // Buckets cover [0, ∞) so a match always exists.
  return bucket ?? (ODDS_BUCKETS[ODDS_BUCKETS.length - 1] as OddsBucket);
}

export const checklistSchema = z
  .partialRecord(z.enum(CHECKLIST_ITEMS), z.enum(TRISTATE_VALUES))
  .refine((c) => c.singleMatch === "TRUE", {
    error: "A ticket must cover exactly one match (single match must be confirmed)",
    path: ["singleMatch"],
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const ticketDetailsSchema = z.object({
  sport: z.string().trim().min(1, { error: "Sport is required" }).max(60),
  competition: z.string().trim().min(1, { error: "Competition is required" }).max(120),
  eventName: z
    .string()
    .trim()
    .min(3, { error: "Match is required, e.g. “Real Madrid - Getafe”" })
    .max(160)
    .refine((v) => !looksLikeMultiMatch(v), {
      error: "One ticket = one single match. This looks like a combo of several matches.",
    }),
  homeTeam: optionalText(80),
  awayTeam: optionalText(80),
  marketName: z.string().trim().min(1, { error: "Market is required" }).max(120),
  selection: z.string().trim().min(1, { error: "Selection is required" }).max(120),
  eventDate: z.string().regex(ISO_DATE_RE, { error: "Event date is required (YYYY-MM-DD)" }),
  eventTime: z
    .string()
    .regex(TIME_RE, { error: "Time must be HH:MM" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: optionalText(2_000),
  protocolStatus: z.enum(PROTOCOL_STATUSES).optional(),
  confidence: z.int().min(1).max(5).optional(),
  closingOddsBp: z.int().min(10_100).max(10_000_000).optional(),
});

export const createTicketSchema = ticketDetailsSchema.extend({
  branchId: z.string().min(1),
  oddsBp: z.int().min(10_100, { error: "Odds must be at least 1.01" }).max(10_000_000),
  stakeCents: z.int().min(1, { error: "Stake must be positive" }),
  checklist: checklistSchema,
  /** Explicit confirmation to bypass the same-event / limit protections. */
  override: z
    .object({
      confirmed: z.literal(true),
      reason: z
        .string()
        .trim()
        .min(3, { error: "Explain why the protection is overridden" })
        .max(500),
    })
    .optional(),
});

export type CreateTicketInput = z.input<typeof createTicketSchema>;
export type CreateTicketData = z.output<typeof createTicketSchema>;

export const updateTicketDetailsSchema = ticketDetailsSchema.partial().extend({
  betId: z.string().min(1),
});
export type UpdateTicketDetailsInput = z.input<typeof updateTicketDetailsSchema>;

export function checklistScore(checklist: Checklist | null | undefined): {
  yes: number;
  no: number;
  unknown: number;
} {
  const values = Object.values(checklist ?? {});
  return {
    yes: values.filter((v) => v === "TRUE").length,
    no: values.filter((v) => v === "FALSE").length,
    unknown: values.filter((v) => v === "UNKNOWN").length,
  };
}
