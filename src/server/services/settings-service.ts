import { desc, eq } from "drizzle-orm";
import {
  DEFAULT_SETTINGS,
  parseStoredSettings,
  strategySettingsSchema,
  type StrategySettings,
} from "@/domain/strategy/settings";
import type { DbOrTx } from "../db/client";
import { settingsHistory, strategySettings } from "../db/schema";
import { DomainError } from "./errors";

const SETTINGS_ROW_ID = 1;

/** Current strategy settings (created with defaults on first read). */
export function getSettings(db: DbOrTx): StrategySettings {
  const row = db
    .select()
    .from(strategySettings)
    .where(eq(strategySettings.id, SETTINGS_ROW_ID))
    .get();
  if (!row) {
    db.insert(strategySettings)
      .values({ id: SETTINGS_ROW_ID, data: DEFAULT_SETTINGS, updatedAt: new Date() })
      .run();
    return DEFAULT_SETTINGS;
  }
  return parseStoredSettings(row.data);
}

/** Validate and persist new settings; the previous version is kept in settings_history. */
export function saveSettings(
  db: DbOrTx,
  input: unknown,
  options: { note?: string; now?: Date } = {},
): StrategySettings {
  const parsed = strategySettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", "Invalid strategy settings", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const now = options.now ?? new Date();
  const previous = getSettings(db);
  db.insert(settingsHistory)
    .values({ data: previous, changedAt: now, note: options.note ?? null })
    .run();
  db.insert(strategySettings)
    .values({ id: SETTINGS_ROW_ID, data: parsed.data, updatedAt: now })
    .onConflictDoUpdate({ target: strategySettings.id, set: { data: parsed.data, updatedAt: now } })
    .run();
  return parsed.data;
}

export function listSettingsHistory(db: DbOrTx, limit = 20) {
  return db.select().from(settingsHistory).orderBy(desc(settingsHistory.id)).limit(limit).all();
}
