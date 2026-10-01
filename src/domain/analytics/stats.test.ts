import { describe, expect, it } from "vitest";
import {
  mean,
  median,
  percentile,
  summarizeTickets,
  wilsonInterval,
  type TicketSample,
} from "./stats";

describe("basic statistics", () => {
  it("computes mean and median (not only the mean)", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(mean([1, 2, 3, 100])).toBe(26.5);
    expect(median([1, 2, 3, 100])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("interpolates percentiles", () => {
    const sorted = [0, 10, 20, 30, 40];
    expect(percentile(sorted, 0.5)).toBe(20);
    expect(percentile(sorted, 0.25)).toBe(10);
    expect(percentile(sorted, 0.9)).toBe(36);
  });

  it("gives a wide Wilson interval for small samples", () => {
    const small = wilsonInterval(8, 10);
    const large = wilsonInterval(800, 1000);
    expect(small && large).toBeTruthy();
    if (!small || !large) return;
    expect(small.high - small.low).toBeGreaterThan(0.4);
    expect(large.high - large.low).toBeLessThan(0.06);
    expect(wilsonInterval(10, 10)?.high).toBe(1);
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe("ticket summary", () => {
  const won = (odds: number): TicketSample => ({
    result: "WON",
    oddsBp: odds,
    stakeCents: 10_000,
    profitLossCents: Math.round(odds - 10_000),
    clvBp: 100,
  });
  const lost = (odds: number): TicketSample => ({
    result: "LOST",
    oddsBp: odds,
    stakeCents: 10_000,
    profitLossCents: -10_000,
    clvBp: null,
  });

  it("withholds the edge below the minimum sample", () => {
    const stats = summarizeTickets([won(13_000), won(13_000), lost(13_000)], 30);
    expect(stats.winRate).toBeCloseTo(2 / 3);
    expect(stats.breakEven).toBeCloseTo(1 / 1.3);
    expect(stats.significant).toBe(false);
    expect(stats.edge).toBeNull();
  });

  it("reports the edge once the sample is large enough", () => {
    const samples = [...Array(40)].map((_, i) => (i < 34 ? won(12_500) : lost(12_500)));
    const stats = summarizeTickets(samples, 30);
    expect(stats.significant).toBe(true);
    expect(stats.edge).toBeCloseTo(34 / 40 - 0.8);
    expect(stats.avgClvBp).toBe(100);
  });

  it("excludes void and pending tickets from the win rate", () => {
    const stats = summarizeTickets(
      [
        won(13_000),
        { ...lost(13_000), result: "VOID", profitLossCents: 0 },
        { ...lost(13_000), result: "PENDING", profitLossCents: null },
      ],
      1,
    );
    expect(stats.decided).toBe(1);
    expect(stats.voids).toBe(1);
    expect(stats.winRate).toBe(1);
  });
});
