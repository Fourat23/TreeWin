import { Crown, Pause, Skull } from "lucide-react";
import { PROFILES } from "@/domain/types";
import { PROFILE_COLOR_VAR, PROFILE_LABEL } from "@/lib/labels";

/** Always-visible, discreet legend. Profiles = colour; status = icon + style (never colour alone). */
export function GraphLegend() {
  return (
    <div
      className="pointer-events-auto flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl border border-border bg-surface/90 px-3 py-2 text-[11px] text-fg-muted backdrop-blur"
      aria-label="Legend"
    >
      {PROFILES.map((p) => (
        <span key={p} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: PROFILE_COLOR_VAR[p] }}
            aria-hidden
          />
          {PROFILE_LABEL[p]}
        </span>
      ))}
      <span className="h-3 w-px bg-border" aria-hidden />
      <span className="flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-full border border-mature shadow-[0_0_6px_1px_var(--mature)]"
          aria-hidden
        />
        <Crown className="size-3 text-mature" aria-hidden /> Mature
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-dead" aria-hidden />
        <Skull className="size-3" aria-hidden /> Dead
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border border-dashed border-paused" aria-hidden />
        <Pause className="size-3 text-paused" aria-hidden /> Paused
      </span>
    </div>
  );
}
