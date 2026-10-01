"use client";

import { CHECKLIST_ITEMS, type Checklist, type ChecklistItem, type Tristate } from "@/domain/types";
import { CHECKLIST_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";

const OPTIONS: { value: Tristate; label: string }[] = [
  { value: "TRUE", label: "Yes" },
  { value: "FALSE", label: "No" },
  { value: "UNKNOWN", label: "?" },
];

/** Optional protocol checklist. `singleMatch` is handled separately as a mandatory confirmation. */
export function ChecklistEditor({
  value,
  onChange,
}: {
  value: Checklist;
  onChange: (next: Checklist) => void;
}) {
  const items = CHECKLIST_ITEMS.filter(
    (i): i is Exclude<ChecklistItem, "singleMatch"> => i !== "singleMatch",
  );
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {items.map((item) => (
        <div key={item} className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="text-[13px] text-fg-muted">{CHECKLIST_LABEL[item]}</span>
          <div role="radiogroup" aria-label={CHECKLIST_LABEL[item]} className="flex gap-0.5">
            {OPTIONS.map((option) => {
              const active = (value[item] ?? "UNKNOWN") === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, [item]: option.value })}
                  className={cn(
                    "h-6 min-w-8 rounded px-1.5 text-[11px] font-medium text-fg-subtle transition-colors hover:text-fg",
                    active && option.value === "TRUE" && "bg-good/15 text-good",
                    active && option.value === "FALSE" && "bg-critical/15 text-critical",
                    active && option.value === "UNKNOWN" && "bg-surface-3 text-fg",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
