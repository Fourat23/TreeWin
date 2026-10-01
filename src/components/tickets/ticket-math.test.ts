import { describe, expect, it } from "vitest";
import { ticketRulesFor } from "@/domain/bets/policy";
import { DEFAULT_SETTINGS } from "@/domain/strategy/settings";
import { computeTicketPreview } from "./ticket-math";

const base = {
  workspace: "REAL" as const,
  branch: {
    code: "A",
    profile: "BALANCED" as const,
    status: "ACTIVE" as const,
    currentCapitalCents: 21_970,
    capCents: 500_000,
  },
  rules: ticketRulesFor(DEFAULT_SETTINGS, "BALANCED"),
};

describe("live ticket preview", () => {
  it("computes return and profit exactly", () => {
    const p = computeTicketPreview({ ...base, stake: "219,70", odds: "1.25" });
    expect(p.stakeCents).toBe(21_970);
    expect(p.potentialReturnCents).toBe(27_463);
    expect(p.potentialProfitCents).toBe(5_493);
    expect(p.warnings).toEqual([]);
    expect(p.violations).toEqual([]);
  });

  it("REAL: a partial stake and odds above 1.30 are blocking, never overridable", () => {
    const p = computeTicketPreview({ ...base, stake: "100", odds: "1.35" });
    expect(p.violations.map((v) => [v.code, v.overridable])).toEqual([
      ["STAKE_NOT_FULL", false],
      ["ODDS_ABOVE_MAX", false],
    ]);
    expect(p.oddsError).toMatch(/1\.30 hard maximum/);
    expect(p.potentialReturnCents).toBeNull();
  });

  it("DEMO: the same violations become explicit, overridable experiments", () => {
    const p = computeTicketPreview({ ...base, workspace: "DEMO", stake: "100", odds: "1.35" });
    expect(p.violations.every((v) => v.overridable)).toBe(true);
    expect(p.oddsError).toBeNull();
    expect(p.potentialReturnCents).toBe(13_500);
  });

  it("flags odds outside the profile corridor as information only", () => {
    const p = computeTicketPreview({ ...base, stake: "219.70", odds: "1.30" });
    expect(p.violations).toEqual([]);
    expect(p.warnings.join(" ")).toMatch(/corridor/);
  });

  it("rejects a stake above the capital and invalid odds", () => {
    expect(computeTicketPreview({ ...base, stake: "300", odds: "1.3" }).stakeError).toMatch(
      /exceeds/,
    );
    expect(computeTicketPreview({ ...base, stake: "100", odds: "0.9" }).oddsError).toMatch(/1\.01/);
    expect(
      computeTicketPreview({ ...base, stake: "abc", odds: "1.3" }).potentialReturnCents,
    ).toBeNull();
  });
});
