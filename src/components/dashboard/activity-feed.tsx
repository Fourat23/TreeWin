"use client";

import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { EventIcon } from "@/components/branch/event-icon";
import { ProfileDot } from "@/components/ui/domain-badges";
import { cn } from "@/lib/cn";
import type { ActivityItemDTO } from "@/server/queries/dto";

/** Human-readable feed of ecosystem events ("A won round 4", "A created A1"...). */
export function ActivityFeed({
  items,
  dense = false,
}: {
  items: ActivityItemDTO[];
  dense?: boolean;
}) {
  const f = useFormat();
  const { openBranch } = useUi();
  if (items.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-fg-subtle">No activity yet.</p>;
  }
  return (
    <ol className="flex flex-col">
      {items.map((item) => {
        const delta = item.capitalDeltaCents;
        const bankIn = item.type === "BANK_TRANSFER" && item.amountCents !== null;
        return (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-3 border-b border-border/70 last:border-0",
              dense ? "py-2" : "py-2.5",
            )}
          >
            <EventIcon type={item.type} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-fg">
                <button
                  type="button"
                  onClick={() => openBranch(item.branchId)}
                  className="mr-1.5 inline-flex items-center gap-1 font-mono font-semibold hover:underline"
                >
                  <ProfileDot profile={item.profile} />
                  {item.branchCode}
                </button>
                <span className="text-fg-muted">{item.description}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-fg-subtle">{f.dateTime(item.createdAt)}</p>
            </div>
            {bankIn ? (
              <span className="shrink-0 num text-[13px] font-medium text-fg">
                {f.money(item.amountCents ?? 0, { signed: true })}
              </span>
            ) : delta !== 0 &&
              (item.type === "BET_WON" ||
                item.type === "BET_LOST" ||
                item.type === "MANUAL_ADJUSTMENT") ? (
              <span
                className={cn(
                  "shrink-0 num text-[13px]",
                  delta > 0 ? "text-good" : "text-fg-muted",
                )}
              >
                {f.money(delta, { signed: true })}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
