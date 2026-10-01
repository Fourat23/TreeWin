import type { BetDTO, BranchEventDTO } from "@/server/queries/dto";

export type TimelineItem =
  { kind: "bet"; bet: BetDTO; events: BranchEventDTO[] } | { kind: "event"; event: BranchEventDTO };

/**
 * Chronological branch history: each ticket appears once (at its creation), carrying the
 * events it caused (result, harvest, BANK transfer, child creation, cap, death, corrections).
 * Events unrelated to a ticket (birth, manual adjustments, profile changes) stand alone.
 */
export function buildRoundTimeline(bets: BetDTO[], events: BranchEventDTO[]): TimelineItem[] {
  const betById = new Map(bets.map((b) => [b.id, b]));
  const groups = new Map<string, BranchEventDTO[]>();
  const items: TimelineItem[] = [];
  for (const event of events) {
    const bet = event.relatedBetId ? betById.get(event.relatedBetId) : undefined;
    // Child birth events reference the parent's ticket but belong to the child's own history.
    if (bet && event.type !== "BIRTH") {
      let group = groups.get(bet.id);
      if (!group) {
        group = [];
        groups.set(bet.id, group);
        items.push({ kind: "bet", bet, events: group });
      }
      if (event.type !== "BET_CREATED") group.push(event);
    } else {
      items.push({ kind: "event", event });
    }
  }
  // Tickets without any event (should not happen) are appended to stay visible.
  for (const bet of bets) {
    if (!groups.has(bet.id)) items.push({ kind: "bet", bet, events: [] });
  }
  return items;
}

/** Event types rendered as annex lines under a round. */
export const ANNEX_TYPES = new Set([
  "HARVEST",
  "BANK_TRANSFER",
  "CHILD_CREATED",
  "SPLIT",
  "CAP_REACHED",
  "DEATH",
  "MANUAL_ADJUSTMENT",
  "BET_CANCELLED",
]);
