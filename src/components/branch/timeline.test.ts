import { describe, expect, it } from "vitest";
import type { BetDTO, BranchEventDTO } from "@/server/queries/dto";
import { buildRoundTimeline } from "./timeline";

const bet = (id: string, roundNumber: number) => ({ id, roundNumber }) as BetDTO;
const event = (id: number, type: BranchEventDTO["type"], relatedBetId: string | null = null) =>
  ({ id, type, relatedBetId }) as BranchEventDTO;

describe("round timeline", () => {
  it("folds each ticket's consequences under its round, in chronological order", () => {
    const items = buildRoundTimeline(
      [bet("b1", 1), bet("b2", 2)],
      [
        event(1, "BIRTH"),
        event(2, "BET_CREATED", "b1"),
        event(3, "BET_WON", "b1"),
        event(4, "BET_CREATED", "b2"),
        event(5, "BET_WON", "b2"),
        event(6, "HARVEST", "b2"),
        event(7, "BANK_TRANSFER", "b2"),
        event(8, "CHILD_CREATED", "b2"),
        event(9, "SPLIT", "b2"),
        event(10, "MANUAL_ADJUSTMENT"),
      ],
    );
    expect(items.map((i) => (i.kind === "bet" ? `R${i.bet.roundNumber}` : i.event.type))).toEqual([
      "BIRTH",
      "R1",
      "R2",
      "MANUAL_ADJUSTMENT",
    ]);
    const r2 = items[2];
    expect(r2?.kind === "bet" && r2.events.map((e) => e.type)).toEqual([
      "BET_WON",
      "HARVEST",
      "BANK_TRANSFER",
      "CHILD_CREATED",
      "SPLIT",
    ]);
  });
});
