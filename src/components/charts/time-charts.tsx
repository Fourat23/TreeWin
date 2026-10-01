"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFormat } from "@/components/providers/format-provider";

const AXIS_TICK = { fill: "var(--fg-subtle)", fontSize: 11 };

function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: { color: string; name: string; value: string }[];
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-3 px-3 py-2 text-xs shadow-panel">
      <p className="mb-1 text-fg-muted">{label}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2 text-fg">
          <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden />
          <span className="text-fg-muted">{r.name}</span>
          <span className="ml-auto pl-3 num font-medium">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Single-series cumulative money over time (BANK). No legend: the card title names it. */
export function MoneyAreaChart({
  data,
  color = "var(--secured)",
  name,
  height = 220,
}: {
  data: { day: string; value: number }[];
  color?: string;
  name: string;
  height?: number;
}) {
  const f = useFormat();
  return (
    <div style={{ height }} role="img" aria-label={`${name} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(d: string) => f.shortDay(d)}
            minTickGap={32}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => f.money(v, { compact: true })}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label ? f.day(String(label)) : undefined}
                rows={(payload ?? []).map((p) => ({
                  color,
                  name,
                  value: f.money(Number(p.value)),
                }))}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.1}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: color }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A few count series over time with a legend (alive vs dead branches). */
export function CountLinesChart({
  data,
  series,
  height = 220,
}: {
  data: Record<string, number | string>[];
  series: { key: string; name: string; color: string }[];
  height?: number;
}) {
  const f = useFormat();
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-4 text-xs text-fg-muted" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-3.5 rounded-full"
              style={{ background: s.color }}
              aria-hidden
            />
            {s.name}
          </li>
        ))}
      </ul>
      <div
        style={{ height }}
        role="img"
        aria-label={series.map((s) => s.name).join(" and ") + " over time"}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="day"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d: string) => f.shortDay(d)}
              minTickGap={32}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={({ active, label, payload }) => (
                <ChartTooltip
                  active={active}
                  label={label ? f.day(String(label)) : undefined}
                  rows={(payload ?? []).map((p) => {
                    const s = series.find((x) => x.key === p.dataKey);
                    return {
                      color: s?.color ?? "var(--fg)",
                      name: s?.name ?? "",
                      value: f.num(Number(p.value)),
                    };
                  })}
                />
              )}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="stepAfter"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                strokeLinecap="round"
                strokeLinejoin="round"
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: s.color }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
