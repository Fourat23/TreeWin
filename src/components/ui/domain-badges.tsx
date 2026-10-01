import {
  Ban,
  CircleCheck,
  CircleDot,
  CircleX,
  Crown,
  FlaskConical,
  Hourglass,
  Pause,
  Skull,
  Sprout,
} from "lucide-react";
import type { BetResult, BranchStatus, Profile } from "@/domain/types";
import { PROFILE_COLOR_VAR, PROFILE_LABEL, RESULT_LABEL, STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { Badge } from "./badge";

/** Profile = colour dot + text label (colour is never the only cue). */
export function ProfileBadge({ profile, className }: { profile: Profile; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-1.5 text-[11px] font-medium text-fg-muted",
        className,
      )}
    >
      <span
        className="size-2 rounded-full"
        style={{ background: PROFILE_COLOR_VAR[profile] }}
        aria-hidden
      />
      {PROFILE_LABEL[profile]}
    </span>
  );
}

export function ProfileDot({ profile, className }: { profile: Profile; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: PROFILE_COLOR_VAR[profile] }}
      aria-hidden
    />
  );
}

const STATUS_STYLE: Record<
  BranchStatus,
  { tone: "good" | "mature" | "dead" | "paused"; Icon: typeof Sprout }
> = {
  ACTIVE: { tone: "good", Icon: Sprout },
  MATURE: { tone: "mature", Icon: Crown },
  DEAD: { tone: "dead", Icon: Skull },
  PAUSED: { tone: "paused", Icon: Pause },
};

export function StatusBadge({ status, className }: { status: BranchStatus; className?: string }) {
  const { tone, Icon } = STATUS_STYLE[status];
  return (
    <Badge tone={tone} className={className}>
      <Icon aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const RESULT_STYLE: Record<
  BetResult,
  { tone: "good" | "critical" | "neutral" | "info"; Icon: typeof CircleCheck }
> = {
  PENDING: { tone: "info", Icon: Hourglass },
  WON: { tone: "good", Icon: CircleCheck },
  LOST: { tone: "critical", Icon: CircleX },
  VOID: { tone: "neutral", Icon: CircleDot },
};

export function ResultBadge({
  result,
  cancelled = false,
}: {
  result: BetResult;
  cancelled?: boolean;
}) {
  if (cancelled) {
    return (
      <Badge tone="neutral">
        <Ban aria-hidden />
        Cancelled
      </Badge>
    );
  }
  const { tone, Icon } = RESULT_STYLE[result];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {RESULT_LABEL[result]}
    </Badge>
  );
}

/** Ticket recorded outside the V1 rules (explicit DEMO experiment). */
export function OutsideV1Badge({ reason }: { reason: string | null }) {
  return (
    <Badge tone="warning" title={reason ?? undefined}>
      <FlaskConical aria-hidden />
      Outside V1
    </Badge>
  );
}
