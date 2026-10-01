import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../strategy/settings";
import { createRng, runSimulation, simulateRun, type SimulationParams } from "./monte-carlo";

const params: SimulationParams = {
  startingCapitalCents: 10_000,
  startingBranches: 2,
  winProbability: 0.8,
  averageOddsBp: 12_800,
  oddsSpreadBp: 300,
  days: 60,
  maxDailyTickets: 4,
  maxBranches: 50,
  runs: 200,
  seed: 42,
  profileDistribution: DEFAULT_SETTINGS.profileDistribution,
};

describe("Monte Carlo simulation", () => {
  it("is reproducible for a given seed", () => {
    const a = runSimulation(params, DEFAULT_SETTINGS);
    const b = runSimulation(params, DEFAULT_SETTINGS);
    expect(a).toEqual(b);
  });

  it("produces ordered percentiles and probabilities in [0, 1]", () => {
    const s = runSimulation(params, DEFAULT_SETTINGS);
    expect(s.bank.p25).toBeLessThanOrEqual(s.bank.median);
    expect(s.bank.median).toBeLessThanOrEqual(s.bank.p75);
    expect(s.bank.p75).toBeLessThanOrEqual(s.bank.p95);
    for (const p of [
      s.probabilityExtinct,
      s.probabilityProfit,
      ...s.probabilityBankAtLeast.map((x) => x.probability),
    ]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(s.fan.length).toBeGreaterThan(0);
    expect(s.evPerTicket).toBeCloseTo(0.8 * 1.28 - 1);
  });

  it("always loses everything when every ticket loses", () => {
    const run = simulateRun({ ...params, winProbability: 0 }, DEFAULT_SETTINGS, createRng(1), true);
    expect(run.extinct).toBe(true);
    expect(run.bankCents).toBe(0);
  });

  it("harvests through the real engine when every ticket wins", () => {
    const run = simulateRun(
      { ...params, winProbability: 1, averageOddsBp: 13_000, oddsSpreadBp: 0, days: 10 },
      DEFAULT_SETTINGS,
      createRng(1),
      false,
    );
    expect(run.extinct).toBe(false);
    expect(run.bankCents).toBeGreaterThanOrEqual(20_000); // both roots reached P1
    expect(run.totalBranches).toBeGreaterThan(2);
  });
});
