import { describe, expect, it } from "vitest";
import { computeTicketPreview } from "./ticket-math";

const base = {
  capitalCents: 21_970,
  suggestedStakeCents: 21_970,
  oddsMinBp: 11_500,
  oddsMaxBp: 13_500,
};

describe("live ticket preview", () => {
  it("computes return and profit exactly", () => {
    const p = computeTicketPreview({ ...base, stake: "219,70", odds: "1.30" });
    expect(p.stakeCents).toBe(21_970);
    expect(p.potentialReturnCents).toBe(28_561);
    expect(p.potentialProfitCents).toBe(6_591);
    expect(p.warnings).toEqual([]);
  });

  it("warns on a lower stake and out-of-range odds", () => {
    const p = computeTicketPreview({ ...base, stake: "100", odds: "1.60" });
    expect(p.warnings).toHaveLength(2);
    expect(p.potentialReturnCents).toBe(16_000);
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
