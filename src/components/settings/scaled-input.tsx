"use client";

import { useState } from "react";
import {
  centsToDecimalString,
  formatMultiple,
  formatOdds,
  parseMoney,
  parseOdds,
  parsePercent,
  parseScaledDecimal,
} from "@/domain/money";
import { AmountInput } from "@/components/ui/amount-input";

export type Scale = "percent" | "multiple" | "decimal" | "money" | "odds" | "int";

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function formatScaled(value: number, scale: Scale): string {
  switch (scale) {
    case "percent":
      return trimZeros(centsToDecimalString(value));
    case "multiple":
    case "decimal":
      return formatMultiple(value);
    case "money":
      return trimZeros(centsToDecimalString(value));
    case "odds":
      return formatOdds(value);
    case "int":
      return String(value);
  }
}

export function parseScaled(text: string, scale: Scale): number | null {
  switch (scale) {
    case "percent":
      return parsePercent(text);
    case "multiple":
    case "decimal":
      return parseScaledDecimal(text, 4);
    case "money":
      return parseMoney(text);
    case "odds":
      return parseOdds(text);
    case "int":
      return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  }
}

const SUFFIX: Record<Scale, string | undefined> = {
  percent: "%",
  multiple: "×",
  decimal: undefined,
  money: "€",
  odds: undefined,
  int: undefined,
};

/** Numeric input bound to an integer-scaled value (bp, cents…) without float conversions. */
export function ScaledInput({
  value,
  scale,
  onChange,
  id,
  nullable = false,
  ...aria
}: {
  value: number | null;
  scale: Scale;
  onChange: (value: number | null) => void;
  id?: string;
  nullable?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(value === null ? "" : formatScaled(value, scale));
  const [invalid, setInvalid] = useState(false);
  return (
    <AmountInput
      id={id}
      {...aria}
      aria-invalid={invalid || aria["aria-invalid"]}
      suffix={SUFFIX[scale]}
      value={text}
      placeholder={nullable ? "unlimited" : undefined}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (nullable && next.trim() === "") {
          setInvalid(false);
          onChange(null);
          return;
        }
        const parsed = parseScaled(next, scale);
        setInvalid(parsed === null);
        if (parsed !== null) onChange(parsed);
      }}
    />
  );
}
