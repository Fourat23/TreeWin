"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  formatBp,
  formatMoney,
  formatNumber,
  formatOdds,
  type MoneyFormatOptions,
} from "@/domain/money";
import { formatDate, formatDateTime, formatIsoDay, formatShortDay } from "@/lib/dates";

export interface FormatConfig {
  locale: string;
  currency: string;
  roundLabel: string;
  roundShortLabel: string;
}

export interface Formatters extends FormatConfig {
  money: (cents: number, options?: Omit<MoneyFormatOptions, "locale" | "currency">) => string;
  odds: (bp: number) => string;
  pct: (bp: number, digits?: number, signed?: boolean) => string;
  ratio: (value: number, digits?: number) => string;
  num: (value: number, digits?: number) => string;
  date: (ms: number) => string;
  dateTime: (ms: number) => string;
  day: (iso: string) => string;
  shortDay: (iso: string) => string;
  round: (n: number) => string;
}

const FormatContext = createContext<Formatters | null>(null);

export function buildFormatters(config: FormatConfig): Formatters {
  const { locale, currency } = config;
  return {
    ...config,
    money: (cents, options) => formatMoney(cents, { ...options, locale, currency }),
    odds: (bp) => formatOdds(bp),
    pct: (bp, digits = 1, signed = false) => formatBp(bp, { locale, digits, signed }),
    ratio: (value, digits = 1) => formatBp(value * 10_000, { locale, digits }),
    num: (value, digits = 0) => formatNumber(value, locale, digits),
    date: (ms) => formatDate(ms, locale),
    dateTime: (ms) => formatDateTime(ms, locale),
    day: (iso) => formatIsoDay(iso, locale),
    shortDay: (iso) => formatShortDay(iso, locale),
    round: (n) => `${config.roundShortLabel}${n}`,
  };
}

export function FormatProvider({
  config,
  children,
}: {
  config: FormatConfig;
  children: ReactNode;
}) {
  const value = useMemo(
    () => buildFormatters(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- config fields are primitives
    [config.locale, config.currency, config.roundLabel, config.roundShortLabel],
  );
  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>;
}

export function useFormat(): Formatters {
  const ctx = useContext(FormatContext);
  if (!ctx) throw new Error("useFormat must be used inside <FormatProvider>");
  return ctx;
}
