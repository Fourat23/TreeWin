import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Input } from "./field";

/** Text input for money / odds: free typing ("285,61"), parsed exactly elsewhere (no floats). */
export const AmountInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { suffix?: string }
>(function AmountInput({ suffix, className, ...props }, ref) {
  return (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cn("num", suffix && "pr-9", className)}
        {...props}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-subtle">
          {suffix}
        </span>
      ) : null}
    </div>
  );
});
