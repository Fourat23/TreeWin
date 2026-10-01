import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseStoredSettings,
  strategySettingsSchema,
} from "../strategy/settings";
import {
  checklistScore,
  clvBp,
  createTicketSchema,
  eventKey,
  looksLikeMultiMatch,
  oddsBucketOf,
} from "./tickets";

const validTicket = {
  branchId: "b1",
  sport: "Football",
  competition: "LaLiga",
  eventName: "Real Madrid - Getafe",
  marketName: "Vainqueur du match",
  selection: "Real Madrid",
  eventDate: "2026-10-04",
  oddsBp: 12_400,
  stakeCents: 10_000,
  checklist: { singleMatch: "TRUE" as const },
};

describe("ticket validation", () => {
  it("accepts a single-match ticket", () => {
    expect(createTicketSchema.safeParse(validTicket).success).toBe(true);
  });

  it("requires the single-match confirmation", () => {
    const result = createTicketSchema.safeParse({
      ...validTicket,
      checklist: { singleMatch: "UNKNOWN" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects combos of several matches", () => {
    expect(looksLikeMultiMatch("PSG - Nantes + Lyon - Lens")).toBe(true);
    expect(looksLikeMultiMatch("PSG - Nantes / Lyon - Lens")).toBe(true);
    expect(looksLikeMultiMatch("Paris Saint-Germain - Nantes")).toBe(false);
    expect(looksLikeMultiMatch("Brighton & Hove Albion vs Chelsea")).toBe(false);
    const result = createTicketSchema.safeParse({
      ...validTicket,
      eventName: "PSG - Nantes + Lyon - Lens",
    });
    expect(result.success).toBe(false);
  });

  it("requires eventName, market and selection", () => {
    for (const key of ["eventName", "marketName", "selection"] as const) {
      expect(createTicketSchema.safeParse({ ...validTicket, [key]: "" }).success).toBe(false);
    }
  });
});

describe("event identity", () => {
  it("normalises names so the same match is detected across branches", () => {
    expect(eventKey("Real Madrid - Getafe", "2026-10-04")).toBe(
      eventKey("  real madrid vs GETAFE ", "2026-10-04"),
    );
    expect(eventKey("Atlético - Séville", "2026-10-04")).toBe(
      eventKey("Atletico – Seville", "2026-10-04"),
    );
    expect(eventKey("Real Madrid - Getafe", "2026-10-04")).not.toBe(
      eventKey("Real Madrid - Getafe", "2026-10-05"),
    );
  });
});

describe("closing line value", () => {
  it("is the price ratio minus one", () => {
    expect(clvBp(13_000, 12_500)).toBe(400); // 1.30 vs 1.25 → +4 %
    expect(clvBp(12_000, 12_500)).toBe(-400);
    expect(clvBp(13_000, null)).toBeNull();
  });
});

describe("odds buckets", () => {
  it.each([
    [11_400, "< 1.15"],
    [11_500, "1.15–1.19"],
    [11_900, "1.15–1.19"],
    [12_200, "1.20–1.22"],
    [12_500, "1.23–1.25"],
    [12_800, "1.26–1.28"],
    [13_000, "1.29–1.30"],
    [13_100, "> 1.30"],
  ])("classifies %i", (odds, label) => {
    expect(oddsBucketOf(odds).label).toBe(label);
  });
});

describe("checklist", () => {
  it("scores answers", () => {
    expect(
      checklistScore({
        singleMatch: "TRUE",
        preMatch: "TRUE",
        lineupKnown: "UNKNOWN",
        noRedFlag: "FALSE",
      }),
    ).toEqual({ yes: 2, no: 1, unknown: 1 });
  });
});

describe("strategy settings", () => {
  it("defaults are valid", () => {
    expect(strategySettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it("fills missing keys from defaults when reading stored settings", () => {
    const parsed = parseStoredSettings({ currency: "EUR", p1: { targetWins: 5 } });
    expect(parsed.p1.targetWins).toBe(5);
    expect(parsed.p1.targetOddsBp).toBe(13_000);
    expect(parsed.profiles.GROWTH.capCents).toBe(1_000_000);
  });

  it("rejects an invalid distribution", () => {
    const result = strategySettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      profileDistribution: { HARVEST: 5_000, BALANCED: 5_000, GROWTH: 1_000 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects shares that leave nothing to the mother", () => {
    const result = strategySettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      profiles: {
        ...DEFAULT_SETTINGS.profiles,
        HARVEST: { ...DEFAULT_SETTINGS.profiles.HARVEST, bankShareBp: 6_000, childShareBp: 4_000 },
      },
    });
    expect(result.success).toBe(false);
  });
});
