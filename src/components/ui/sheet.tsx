"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Side panel on desktop, bottom sheet on mobile. Non-modal on desktop so the graph behind
 * stays interactive (pan/zoom, clicking another node).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <D.Portal>
        <D.Content
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "ct-rise fixed inset-x-0 bottom-0 z-40 flex h-[86dvh] flex-col rounded-t-2xl border border-border bg-surface shadow-panel outline-none",
            "md:inset-y-0 md:right-0 md:left-auto md:h-auto md:w-[min(600px,100vw)] md:rounded-none md:rounded-l-2xl md:border-y-0 md:border-r-0",
            className,
          )}
        >
          <div
            className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong md:hidden"
            aria-hidden
          />
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{description ?? "Details"}</D.Description>
          <D.Close
            className="absolute top-3 right-3 z-10 rounded-md p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            aria-label="Close panel"
          >
            <X className="size-4" />
          </D.Close>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
