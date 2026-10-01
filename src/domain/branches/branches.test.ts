import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../strategy/settings";
import {
  childCode,
  compareBranchCodes,
  generationFromCode,
  nextRootCode,
  rootCode,
  rootIndex,
} from "./codes";
import { ancestorsOf, buildTreeIndex, descendantsOf, lineageIds } from "./lineage";
import { bestWinStreak, branchRoiBp, lifetimeValueCents, verifyLedger, winRate } from "./metrics";
import { emptyProfileCounts, pickQuotaProfile, pickRandomProfile } from "./profile-picker";

describe("branch codes", () => {
  it("generates root codes A..Z, AA..", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(rootCode)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
    ]);
    expect(rootIndex("AA")).toBe(26);
    expect(nextRootCode([])).toBe("A");
    expect(nextRootCode(["A", "B"])).toBe("C");
    expect(nextRootCode(["A", "C"])).toBe("D");
  });

  it("generates child codes A1, A1.2, A1.2.3", () => {
    expect(childCode("A", 1)).toBe("A1");
    expect(childCode("A1", 2)).toBe("A1.2");
    expect(childCode("A1.2", 3)).toBe("A1.2.3");
    expect(generationFromCode("A")).toBe(0);
    expect(generationFromCode("A12")).toBe(1);
    expect(generationFromCode("A1.2.3")).toBe(3);
  });

  it("sorts codes naturally", () => {
    expect(["A10", "A2", "A1.10", "A1.2", "B"].sort(compareBranchCodes)).toEqual([
      "A1.2",
      "A1.10",
      "A2",
      "A10",
      "B",
    ]);
  });
});

describe("profile assignment", () => {
  it("follows the 50/35/15 quota deterministically", () => {
    const counts = emptyProfileCounts();
    const sequence: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const profile = pickQuotaProfile(DEFAULT_SETTINGS.profileDistribution, counts);
      counts[profile] += 1;
      sequence.push(profile);
    }
    expect(counts).toEqual({ HARVEST: 10, BALANCED: 7, GROWTH: 3 });
    expect(sequence[0]).toBe("HARVEST");
  });

  it("skips profiles with a zero weight", () => {
    const profile = pickQuotaProfile(
      { HARVEST: 0, BALANCED: 0, GROWTH: 10_000 },
      emptyProfileCounts(),
    );
    expect(profile).toBe("GROWTH");
  });

  it("draws weighted random profiles", () => {
    const dist = DEFAULT_SETTINGS.profileDistribution;
    expect(pickRandomProfile(dist, () => 0)).toBe("HARVEST");
    expect(pickRandomProfile(dist, () => 0.6)).toBe("BALANCED");
    expect(pickRandomProfile(dist, () => 0.9)).toBe("GROWTH");
  });
});

describe("lineage", () => {
  const items = [
    { id: "a", parentId: null },
    { id: "a1", parentId: "a" },
    { id: "a2", parentId: "a" },
    { id: "a2.1", parentId: "a2" },
    { id: "a2.1.1", parentId: "a2.1" },
    { id: "b", parentId: null },
  ];
  const index = buildTreeIndex(items);

  it("finds ancestors root-first", () => {
    expect(ancestorsOf(index, "a2.1.1").map((i) => i.id)).toEqual(["a", "a2", "a2.1"]);
  });

  it("finds descendants breadth-first", () => {
    expect(descendantsOf(index, "a").map((i) => i.id)).toEqual(["a1", "a2", "a2.1", "a2.1.1"]);
  });

  it("builds a lineage set", () => {
    expect([...lineageIds(index, "a2")].sort()).toEqual(["a", "a2", "a2.1", "a2.1.1"]);
  });
});

describe("branch metrics", () => {
  it("computes lifetime value and ROI", () => {
    const ltv = lifetimeValueCents({
      currentCapitalCents: 0,
      totalBankGeneratedCents: 10_000,
      totalChildCapitalGeneratedCents: 10_000,
    });
    expect(ltv).toBe(20_000);
    expect(branchRoiBp(ltv, 10_000)).toBe(10_000);
  });

  it("computes win rate and streaks", () => {
    expect(winRate(0, 0)).toBeNull();
    expect(winRate(3, 1)).toBe(0.75);
    expect(bestWinStreak(["WON", "WON", "VOID", "WON", "LOST", "WON"])).toBe(3);
  });

  it("detects ledger mismatches", () => {
    const check = verifyLedger(
      [
        { capitalDeltaCents: 10_000, capitalAfterCents: 10_000 },
        { capitalDeltaCents: 3_000, capitalAfterCents: 13_001 },
      ],
      13_000,
    );
    expect(check.balanced).toBe(false);
    expect(check.firstMismatchIndex).toBe(1);
  });
});
