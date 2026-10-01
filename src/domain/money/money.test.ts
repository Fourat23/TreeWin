import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import {
  applyBp,
  calculateProfit,
  calculateReturn,
  centsToDecimalString,
  formatMultiple,
  formatOdds,
  impliedProbabilityBp,
  mulDivRound,
  parseMoney,
  parseOdds,
  parsePercent,
  roundMoney,
} from "./money";

describe("money arithmetic", () => {
  it("computes a simple win: 100 € @1.30 → 130 €", () => {
    expect(calculateReturn(10_000, 13_000)).toBe(13_000);
    expect(calculateProfit(10_000, 13_000)).toBe(3_000);
  });

  it("chains four rounds at 1.30 without float drift", () => {
    const path = [10_000];
    for (let i = 0; i < 4; i += 1) path.push(calculateReturn(path[i] as number, 13_000));
    expect(path).toEqual([10_000, 13_000, 16_900, 21_970, 28_561]);
  });

  it("avoids the classic 0.1 + 0.2 problem by staying in integer cents", () => {
    expect(10 + 20).toBe(30);
    expect(centsToDecimalString(10 + 20)).toBe("0.30");
  });

  it("rounds half away from zero, exactly once", () => {
    expect(mulDivRound(1, 1, 2)).toBe(1); // 0.5 → 1
    expect(mulDivRound(-1, 1, 2)).toBe(-1); // -0.5 → -1
    expect(mulDivRound(3, 1, 2)).toBe(2); // 1.5 → 2
    expect(calculateReturn(3_333, 12_500)).toBe(4_166); // 41.6625 → 41.66
    expect(calculateReturn(1_001, 12_500)).toBe(1_251); // 12.5125 → 12.51
    expect(calculateReturn(1_002, 12_500)).toBe(1_253); // 12.525 → 12.53 (half up)
  });

  it("handles large amounts exactly", () => {
    expect(calculateReturn(9_999_999_999, 13_000)).toBe(12_999_999_999);
  });

  it("applies basis-point ratios", () => {
    expect(applyBp(41_200, 2_500)).toBe(10_300);
    expect(applyBp(10_000, 28_561)).toBe(28_561);
  });

  it("rejects invalid odds and stakes", () => {
    expect(() => calculateReturn(100, 9_000)).toThrow(RangeError);
    expect(() => calculateReturn(-1, 13_000)).toThrow(RangeError);
    expect(() => calculateReturn(1.5, 13_000)).toThrow(RangeError);
  });

  it("rounds derived display values", () => {
    expect(roundMoney(12.5)).toBe(13);
    expect(roundMoney(-12.5)).toBe(-13);
    expect(roundMoney(-0.4)).toBe(0);
  });
});

describe("parsing", () => {
  it.each([
    ["285.61", 28_561],
    ["285,61", 28_561],
    ["1 234,5", 123_450],
    ["1,234.50", 123_450],
    ["1.234,50", 123_450],
    ["12 €", 1_200],
    ["0,1", 10],
    ["-5", -500],
  ])("parses money %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "12,345", "1e3"])("rejects invalid money %s", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("parses odds", () => {
    expect(parseOdds("1.30")).toBe(13_000);
    expect(parseOdds("1,3")).toBe(13_000);
    expect(parseOdds("1.255")).toBe(12_550);
    expect(parseOdds("1.00")).toBeNull();
    expect(parseOdds("0.9")).toBeNull();
  });

  it("parses percentages", () => {
    expect(parsePercent("25")).toBe(2_500);
    expect(parsePercent("12,5 %")).toBe(1_250);
  });
});

describe("formatting", () => {
  it("formats odds and multiples", () => {
    expect(formatOdds(13_000)).toBe("1.30");
    expect(formatOdds(12_550)).toBe("1.255");
    expect(formatMultiple(28_561)).toBe("2.8561");
    expect(formatMultiple(40_000)).toBe("4");
  });

  it("formats money in the configured locale", () => {
    const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
    expect(normalize(formatMoney(28_561))).toBe("285,61 €");
    expect(normalize(formatMoney(482_000))).toBe("4 820,00 €");
    expect(normalize(formatMoney(6_591, { signed: true }))).toBe("+65,91 €");
    expect(formatMoney(28_561, { locale: "en-IE" })).toBe("€285.61");
  });

  it("computes implied probability", () => {
    expect(impliedProbabilityBp(13_000)).toBe(7_692);
    expect(impliedProbabilityBp(20_000)).toBe(5_000);
  });

  it("converts cents to decimal strings", () => {
    expect(centsToDecimalString(28_561)).toBe("285.61");
    expect(centsToDecimalString(-5)).toBe("-0.05");
  });
});
