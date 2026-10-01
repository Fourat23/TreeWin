import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const TONES = {
  neutral: "bg-surface-2 text-fg-muted border-border",
  good: "bg-good/10 text-good border-good/25",
  warning: "bg-warning/10 text-warning border-warning/30",
  critical: "bg-critical/10 text-critical border-critical/30",
  mature: "bg-mature/10 text-mature border-mature/35",
  paused: "bg-paused/10 text-paused border-paused/30",
  dead: "bg-dead/15 text-fg-subtle border-dead/40",
  info: "bg-balanced/10 text-balanced border-balanced/30",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap [&_svg]:size-3",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
