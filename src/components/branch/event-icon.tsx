import {
  Ban,
  CircleCheck,
  CircleDot,
  CircleX,
  Crown,
  GitFork,
  Landmark,
  Pause,
  PenLine,
  Scissors,
  Skull,
  Sprout,
  Tag,
  Ticket,
  Wheat,
} from "lucide-react";
import type { BranchEventType } from "@/domain/types";
import { cn } from "@/lib/cn";

const ICONS: Record<BranchEventType, { Icon: typeof Ticket; className: string }> = {
  BIRTH: { Icon: Sprout, className: "text-good" },
  BET_CREATED: { Icon: Ticket, className: "text-fg-muted" },
  BET_WON: { Icon: CircleCheck, className: "text-good" },
  BET_LOST: { Icon: CircleX, className: "text-critical" },
  BET_VOID: { Icon: CircleDot, className: "text-fg-muted" },
  BET_CANCELLED: { Icon: Ban, className: "text-fg-subtle" },
  HARVEST: { Icon: Wheat, className: "text-mature" },
  BANK_TRANSFER: { Icon: Landmark, className: "text-fg" },
  SPLIT: { Icon: Scissors, className: "text-fg-muted" },
  CHILD_CREATED: { Icon: GitFork, className: "text-balanced" },
  CAP_REACHED: { Icon: Crown, className: "text-mature" },
  PROFILE_CHANGED: { Icon: Tag, className: "text-warning" },
  STATUS_CHANGED: { Icon: Pause, className: "text-paused" },
  MANUAL_ADJUSTMENT: { Icon: PenLine, className: "text-warning" },
  DEATH: { Icon: Skull, className: "text-critical" },
};

export function EventIcon({ type, className }: { type: BranchEventType; className?: string }) {
  const { Icon, className: tone } = ICONS[type];
  return <Icon className={cn("size-4 shrink-0", tone, className)} aria-hidden />;
}
