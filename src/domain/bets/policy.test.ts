import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../strategy/settings";
import { evaluateTicketPolicy, ticketRulesFor, type TicketPolicyInput } from "./policy";

const base: TicketPolicyInput = {
  workspace: "REAL",
  rules: ticketRulesFor(DEFAULT_SETTINGS, "BALANCED"),
  branch: {
    code: "A",
    profile: "BALANCED",
    status: "ACTIVE",
    currentCapitalCents: 13_000,
    capCents: 500_000,
  },
  stakeCents: 13_000,
  oddsBp: 12_500,
  sameEventBranchCodes: [],
  pendingLimitReached: false,
  dailyLimitReached: false,
};

const codes = (input: Partial<TicketPolicyInput>) =>
  evaluateTicketPolicy({ ...base, ...input }).violations.map((v) => [v.code, v.overridable]);

describe("ticket policy", () => {
  it("accepts a full-stake ticket within 1.30", () => {
    expect(evaluateTicketPolicy(base).violations).toEqual([]);
  });

  it("REAL blocks a partial stake without any override", () => {
    expect(codes({ stakeCents: 10_000 })).toEqual([["STAKE_NOT_FULL", false]]);
  });

  it("REAL blocks odds above 1.30 without any override", () => {
    expect(codes({ oddsBp: 13_100 })).toEqual([["ODDS_ABOVE_MAX", false]]);
    expect(codes({ oddsBp: 13_000 })).toEqual([]);
  });

  it("REAL blocks the same match on two branches", () => {
    expect(codes({ sameEventBranchCodes: ["B"] })).toEqual([["SAME_EVENT", false]]);
  });

  it("DEMO allows explicit overrides of the same violations", () => {
    expect(
      codes({ workspace: "DEMO", stakeCents: 10_000, oddsBp: 13_500, sameEventBranchCodes: ["B"] }),
    ).toEqual([
      ["STAKE_NOT_FULL", true],
      ["ODDS_ABOVE_MAX", true],
      ["SAME_EVENT", true],
    ]);
  });

  it("requires the capped principal for a mature branch", () => {
    const mature = { ...base.branch, status: "MATURE" as const, currentCapitalCents: 500_000 };
    expect(
      evaluateTicketPolicy({ ...base, branch: mature, stakeCents: 500_000 }).requiredStakeCents,
    ).toBe(500_000);
    expect(codes({ branch: mature, stakeCents: 400_000 })).toEqual([["STAKE_NOT_FULL", false]]);
  });

  it("never allows a stake above the capital, even in DEMO", () => {
    expect(codes({ workspace: "DEMO", stakeCents: 13_001 })).toEqual([
      ["STAKE_ABOVE_CAPITAL", false],
    ]);
  });

  it("warns below the minimum odds and outside the profile corridor", () => {
    const result = evaluateTicketPolicy({ ...base, oddsBp: 11_500 });
    expect(result.violations).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/minimum/);
    expect(result.warnings.join(" ")).toMatch(/corridor/);
  });
});
