import {
  isStrategyChange,
  strategySettingsSchema,
  type StrategySettings,
} from "@/domain/strategy/settings";
import type { WorkspaceState } from "../state/schema";
import { DomainError } from "./errors";
import type { OpContext } from "./internal";

/**
 * Replace the workspace settings. The previous version is kept in `settingsHistory`; any change
 * to a strategy rule bumps the workspace strategy revision (stamped on new branches/tickets).
 */
export function saveSettings(
  state: WorkspaceState,
  input: unknown,
  ctx: OpContext,
  note: string | null = null,
): { settings: StrategySettings; strategyChanged: boolean } {
  const parsed = strategySettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", "Invalid strategy settings", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const previous = state.settings;
  const strategyChanged = isStrategyChange(previous, parsed.data);
  state.settingsHistory.push({
    id: (state.settingsHistory.at(-1)?.id ?? 0) + 1,
    changedAt: ctx.now.getTime(),
    note,
    revision: state.metadata.strategyRevision,
    data: previous,
  });
  if (strategyChanged) state.metadata.strategyRevision += 1;
  state.settings = parsed.data;
  return { settings: parsed.data, strategyChanged };
}
