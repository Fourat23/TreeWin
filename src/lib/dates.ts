const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

export function formatDate(ms: number, locale: string): string {
  return formatter(locale, { day: "2-digit", month: "short", year: "numeric" }).format(ms);
}

export function formatDateTime(ms: number, locale: string): string {
  return formatter(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** "2026-10-04" (match day) → localized short date, without timezone shifts. */
export function formatIsoDay(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return formatter(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(y, m - 1, d),
  );
}

export function formatShortDay(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return formatter(locale, { day: "2-digit", month: "short" }).format(new Date(y, m - 1, d));
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}
