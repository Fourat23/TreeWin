/**
 * Money, odds and ratio arithmetic.
 *
 * Rounding & precision policy (applies to the whole application):
 *
 * - Monetary amounts are always integer **cents** (`Cents`). 100 € = 10_000.
 * - Odds are integer **basis points** (`OddsBp`): odds × 10_000. 1.30 = 13_000.
 * - Ratios, percentages and multiples are integer basis points (`Bp`):
 *   10_000 = 100 % = a 1× multiple. 25 % = 2_500. 2.8561× = 28_561.
 * - Any product that can create fractional cents is computed exactly with BigInt and
 *   rounded ONCE to the nearest cent, half away from zero (standard "arrondi au centime").
 * - Allocations (BANK / child / remainder) never round independently: the first parts are
 *   rounded and the last part is the remainder, so cents are always conserved.
 *
 * Floating point is only used for display (charts, percentages), never for stored amounts.
 */

export type Cents = number;
export type OddsBp = number;
export type Bp = number;

export const CENTS_PER_UNIT = 100;
export const ODDS_SCALE = 10_000;
export const BP_SCALE = 10_000;

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents, received ${value}`);
  }
}

/**
 * Exact `a × b / divisor`, rounded half away from zero. All inputs must be safe integers.
 */
export function mulDivRound(a: number, b: number, divisor: number): number {
  assertCents(a, "a");
  assertCents(b, "b");
  assertCents(divisor, "divisor");
  if (divisor === 0) throw new RangeError("Division by zero");
  const product = BigInt(a) * BigInt(b);
  const d = BigInt(divisor);
  const negative = product < 0n !== d < 0n;
  const absProduct = product < 0n ? -product : product;
  const absDivisor = d < 0n ? -d : d;
  const rounded = (absProduct * 2n + absDivisor) / (absDivisor * 2n);
  const result = Number(negative ? -rounded : rounded);
  assertCents(result, "result");
  return result;
}

/** Gross return of a ticket: stake × odds, rounded to the cent. */
export function calculateReturn(stakeCents: Cents, oddsBp: OddsBp): Cents {
  assertCents(stakeCents, "stake");
  if (stakeCents < 0) throw new RangeError("Stake cannot be negative");
  if (!Number.isSafeInteger(oddsBp) || oddsBp < ODDS_SCALE) {
    throw new RangeError(`Odds must be >= 1.00, received ${oddsBp} bp`);
  }
  return mulDivRound(stakeCents, oddsBp, ODDS_SCALE);
}

/** Net profit of a winning ticket: return − stake. */
export function calculateProfit(stakeCents: Cents, oddsBp: OddsBp): Cents {
  return calculateReturn(stakeCents, oddsBp) - stakeCents;
}

/** Apply a basis-point ratio to an amount (e.g. 25 % of capital, 2.8561 × S). */
export function applyBp(amountCents: Cents, ratioBp: Bp): Cents {
  return mulDivRound(amountCents, ratioBp, BP_SCALE);
}

/**
 * Round an arbitrary (possibly fractional) cent value to whole cents, half away from zero.
 * Only use for derived display values such as averages — never for ledger amounts.
 */
export function roundMoney(cents: number): Cents {
  if (!Number.isFinite(cents)) throw new RangeError("Cannot round a non-finite amount");
  const rounded = Math.sign(cents) * Math.round(Math.abs(cents));
  return rounded === 0 ? 0 : rounded;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  assertCents(total, "sum");
  return total;
}

const DECIMAL_RE = /^([+-])?(\d+)(?:[.,](\d*))?$/;

/**
 * Parse a user-entered decimal number into an integer scaled by 10^decimals, without floats.
 * Accepts "1 234,56", "1234.5", "€ 12", "12,30 €". Returns null when invalid or when the
 * input has more fractional digits than allowed.
 */
export function parseScaledDecimal(input: string, decimals: number): number | null {
  const cleaned = input
    .trim()
    .replace(/[€$£\s  ']/g, "")
    .replace(/^\+/, "");
  if (cleaned === "") return null;
  // Accept a thousands separator only when a different decimal separator is also present.
  let normalized = cleaned;
  if (normalized.includes(",") && normalized.includes(".")) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    normalized =
      lastComma > lastDot
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  }
  const match = DECIMAL_RE.exec(normalized);
  if (!match) return null;
  const [, sign, intPart = "0", fracPart = ""] = match;
  if (fracPart.length > decimals) return null;
  const scaled =
    BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPart.padEnd(decimals, "0") || "0");
  const value = Number(sign === "-" ? -scaled : scaled);
  return Number.isSafeInteger(value) ? value : null;
}

/** Parse a money string ("285,61", "285.61 €") into cents. */
export function parseMoney(input: string): Cents | null {
  return parseScaledDecimal(input, 2);
}

/** Parse decimal odds ("1.30", "1,3") into basis points. Returns null when invalid or < 1.01. */
export function parseOdds(input: string): OddsBp | null {
  const value = parseScaledDecimal(input, 4);
  if (value === null || value < 10_100) return null;
  return value;
}

/** Parse a percentage string ("25", "12.5 %") into basis points (25 % → 2_500). */
export function parsePercent(input: string): Bp | null {
  return parseScaledDecimal(input.replace(/%/g, ""), 2);
}

export function eurosToCents(euros: number): Cents {
  return roundMoney(euros * CENTS_PER_UNIT);
}

/** Convert cents to a JS number of currency units. Display / charting only. */
export function centsToUnits(cents: Cents): number {
  return cents / CENTS_PER_UNIT;
}

/** Plain decimal string with a dot separator, e.g. 28561 → "285.61". For CSV and inputs. */
export function centsToDecimalString(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.trunc(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${units}.${rest}`;
}

export function oddsToNumber(oddsBp: OddsBp): number {
  return oddsBp / ODDS_SCALE;
}

/** Odds basis points → "1.30". Uses 2 decimals unless more precision is present. */
export function formatOdds(oddsBp: OddsBp, minDigits = 2): string {
  const units = Math.trunc(oddsBp / ODDS_SCALE);
  let frac = String(oddsBp % ODDS_SCALE).padStart(4, "0");
  while (frac.length > minDigits && frac.endsWith("0")) frac = frac.slice(0, -1);
  return frac === "" ? String(units) : `${units}.${frac}`;
}

/** Basis points → decimal multiple string, e.g. 28561 → "2.8561", 40000 → "4". */
export function formatMultiple(bp: Bp): string {
  return formatOdds(bp, 0);
}

/** Implied probability (1 / odds) in basis points: 1.30 → 7_692 (76.92 %). */
export function impliedProbabilityBp(oddsBp: OddsBp): Bp {
  return mulDivRound(BP_SCALE, ODDS_SCALE, oddsBp);
}
