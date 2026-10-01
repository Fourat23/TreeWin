import { BP_SCALE, CENTS_PER_UNIT, type Bp, type Cents } from "./money";

export interface MoneyFormatOptions {
  locale?: string;
  currency?: string;
  /** Prefix positive values with "+" (useful for deltas). */
  signed?: boolean;
  /** Compact notation for large values (1,2 k €). */
  compact?: boolean;
  /** Hide decimals when the amount is a whole number of units. */
  trimZeroCents?: boolean;
}

export const DEFAULT_LOCALE = "fr-FR";
export const DEFAULT_CURRENCY = "EUR";

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(key: string, factory: () => Intl.NumberFormat): Intl.NumberFormat {
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = factory();
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Format integer cents as currency. Division by 100 happens only here, for display.
 */
export function formatMoney(cents: Cents, options: MoneyFormatOptions = {}): string {
  const {
    locale = DEFAULT_LOCALE,
    currency = DEFAULT_CURRENCY,
    signed = false,
    compact = false,
    trimZeroCents = false,
  } = options;
  const whole = cents % CENTS_PER_UNIT === 0;
  const digits = compact ? undefined : trimZeroCents && whole ? 0 : 2;
  const key = `${locale}|${currency}|${compact}|${digits}|${signed}`;
  const formatter = getFormatter(
    key,
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        minimumFractionDigits: compact ? 0 : digits,
        maximumFractionDigits: compact ? 1 : digits,
        signDisplay: signed ? "exceptZero" : "auto",
      }),
  );
  return formatter.format(cents / CENTS_PER_UNIT);
}

/** Format a plain number with grouping (counts, rounds). */
export function formatNumber(value: number, locale = DEFAULT_LOCALE, fractionDigits = 0): string {
  const key = `num|${locale}|${fractionDigits}`;
  const formatter = getFormatter(
    key,
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }),
  );
  return formatter.format(value);
}

/** Basis points → "25 %" / "+3.1 %". */
export function formatBp(
  bp: Bp,
  options: { locale?: string; digits?: number; signed?: boolean } = {},
): string {
  const { locale = DEFAULT_LOCALE, digits = 1, signed = false } = options;
  const key = `pct|${locale}|${digits}|${signed}`;
  const formatter = getFormatter(
    key,
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: signed ? "exceptZero" : "auto",
      }),
  );
  return formatter.format(bp / BP_SCALE);
}

/** Ratio (0..1 float) → "54.5 %". */
export function formatRatio(ratio: number, locale = DEFAULT_LOCALE, digits = 1): string {
  return formatBp(ratio * BP_SCALE, { locale, digits });
}
