"use client";

import { FlaskConical, Play, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  estimateWork,
  SIMULATION_LIMITS,
  type SimulationParams,
  type SimulationSummary,
} from "@/domain/simulation/monte-carlo";
import type { StrategySettings } from "@/domain/strategy/settings";
import { PROFILES } from "@/domain/types";
import { ScaledInput } from "@/components/settings/scaled-input";
import { useFormat } from "@/components/providers/format-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { EmptyState, Progress } from "@/components/ui/misc";
import { PROFILE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { SimulationMessage, SimulationRequest } from "@/workers/simulation.worker";

interface FormState {
  startingCapitalCents: number;
  startingBranches: number;
  winProbabilityBp: number;
  averageOddsBp: number;
  oddsSpreadBp: number;
  days: number;
  maxDailyTickets: number;
  maxBranches: number;
  runs: number;
  seed: number;
  distribution: StrategySettings["profileDistribution"];
}

export function SimulationView({ settings }: { settings: StrategySettings }) {
  const f = useFormat();
  const [form, setForm] = useState<FormState>({
    startingCapitalCents: 10_000,
    startingBranches: 3,
    winProbabilityBp: 8_000,
    averageOddsBp: 12_600,
    oddsSpreadBp: 400,
    days: 180,
    maxDailyTickets: 5,
    maxBranches: 200,
    runs: 2_000,
    seed: 20261001,
    distribution: settings.profileDistribution,
  });
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{
    summary: SimulationSummary;
    elapsedMs: number;
    params: SimulationParams;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: number | null) =>
      setForm((prev) => ({ ...prev, [key]: value ?? prev[key] }));

  const distributionTotal = PROFILES.reduce((s, p) => s + form.distribution[p], 0);
  const work = estimateWork(form);
  const valid =
    distributionTotal === 10_000 &&
    form.runs >= 1 &&
    form.runs <= SIMULATION_LIMITS.maxRuns &&
    form.days >= 1 &&
    form.days <= SIMULATION_LIMITS.maxDays &&
    form.startingBranches >= 1 &&
    form.startingBranches <= SIMULATION_LIMITS.maxStartingBranches &&
    form.maxDailyTickets >= 1 &&
    form.maxDailyTickets <= SIMULATION_LIMITS.maxDailyTickets &&
    form.maxBranches >= 1 &&
    form.maxBranches <= SIMULATION_LIMITS.maxBranches &&
    form.winProbabilityBp <= 10_000 &&
    form.startingCapitalCents >= 100;

  function run() {
    workerRef.current?.terminate();
    const params: SimulationParams = {
      startingCapitalCents: form.startingCapitalCents,
      startingBranches: form.startingBranches,
      winProbability: form.winProbabilityBp / 10_000,
      averageOddsBp: form.averageOddsBp,
      oddsSpreadBp: form.oddsSpreadBp,
      days: form.days,
      maxDailyTickets: form.maxDailyTickets,
      maxBranches: form.maxBranches,
      runs: form.runs,
      seed: form.seed,
      profileDistribution: form.distribution,
    };
    const worker = new Worker(new URL("../../workers/simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setProgress(0);
    setError(null);
    worker.onmessage = (event: MessageEvent<SimulationMessage>) => {
      const message = event.data;
      if (message.type === "progress") setProgress(message.done / params.runs);
      else if (message.type === "done") {
        setResult({ summary: message.summary, elapsedMs: message.elapsedMs, params });
        setProgress(null);
        worker.terminate();
      } else {
        setError(message.message);
        setProgress(null);
        worker.terminate();
      }
    };
    worker.onerror = (event) => {
      setError(event.message || "Worker error");
      setProgress(null);
    };
    const request: SimulationRequest = { params, settings };
    worker.postMessage(request);
  }

  function cancel() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setProgress(null);
  }

  const running = progress !== null;

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <Card className="self-start">
        <CardHeader
          title="Parameters"
          description="Uses your current strategy settings (thresholds, caps, P1, mature split)."
        />
        <CardBody className="grid grid-cols-2 gap-3">
          <Field label="Starting capital / branch">
            {(p) => (
              <ScaledInput
                {...p}
                scale="money"
                value={form.startingCapitalCents}
                onChange={set("startingCapitalCents")}
              />
            )}
          </Field>
          <Field label="Starting branches">
            {(p) => (
              <ScaledInput
                {...p}
                scale="int"
                value={form.startingBranches}
                onChange={set("startingBranches")}
              />
            )}
          </Field>
          <Field label="Win probability">
            {(p) => (
              <ScaledInput
                {...p}
                scale="percent"
                value={form.winProbabilityBp}
                onChange={set("winProbabilityBp")}
              />
            )}
          </Field>
          <Field label="Average odds">
            {(p) => (
              <ScaledInput
                {...p}
                scale="odds"
                value={form.averageOddsBp}
                onChange={set("averageOddsBp")}
              />
            )}
          </Field>
          <Field label="Odds spread (±)" hint="uniform">
            {(p) => (
              <ScaledInput
                {...p}
                scale="decimal"
                value={form.oddsSpreadBp}
                onChange={set("oddsSpreadBp")}
              />
            )}
          </Field>
          <Field label="Days">
            {(p) => <ScaledInput {...p} scale="int" value={form.days} onChange={set("days")} />}
          </Field>
          <Field label="Max daily tickets">
            {(p) => (
              <ScaledInput
                {...p}
                scale="int"
                value={form.maxDailyTickets}
                onChange={set("maxDailyTickets")}
              />
            )}
          </Field>
          <Field label="Max alive branches">
            {(p) => (
              <ScaledInput
                {...p}
                scale="int"
                value={form.maxBranches}
                onChange={set("maxBranches")}
              />
            )}
          </Field>
          <Field label="Runs" hint={`max ${f.num(SIMULATION_LIMITS.maxRuns)}`}>
            {(p) => <ScaledInput {...p} scale="int" value={form.runs} onChange={set("runs")} />}
          </Field>
          <Field label="Seed" hint="same seed = same result">
            {(p) => <ScaledInput {...p} scale="int" value={form.seed} onChange={set("seed")} />}
          </Field>
          <fieldset className="col-span-2 grid grid-cols-3 gap-2">
            <legend className="mb-1.5 text-[13px] font-medium text-fg-muted">
              Profile distribution
            </legend>
            {PROFILES.map((profile) => (
              <ScaledInput
                key={profile}
                aria-label={`${PROFILE_LABEL[profile]} share`}
                scale="percent"
                value={form.distribution[profile]}
                onChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    distribution: { ...prev.distribution, [profile]: v ?? 0 },
                  }))
                }
              />
            ))}
            <p
              className={cn(
                "col-span-3 text-[11px]",
                distributionTotal === 10_000 ? "text-fg-subtle" : "text-critical",
              )}
            >
              {PROFILES.map((p) => PROFILE_LABEL[p]).join(" / ")} — total{" "}
              {f.pct(distributionTotal, 0)}
            </p>
          </fieldset>
          <p className="col-span-2 text-[11px] text-fg-subtle">
            ≈ {f.num(work)} simulated tickets at most. Runs locally in a background worker.
          </p>
          <div className="col-span-2 flex gap-2">
            {running ? (
              <Button variant="danger" className="flex-1" onClick={cancel}>
                <Square /> Cancel
              </Button>
            ) : (
              <Button variant="primary" className="flex-1" onClick={run} disabled={!valid}>
                <Play /> Run simulation
              </Button>
            )}
          </div>
          {running ? (
            <div className="col-span-2">
              <Progress value={progress ?? 0} color="var(--fg)" label="Simulation progress" />
              <p className="mt-1 num text-xs text-fg-subtle">{f.ratio(progress ?? 0, 0)}</p>
            </div>
          ) : null}
          {error ? <p className="col-span-2 text-sm text-critical">{error}</p> : null}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-5">
        {result ? (
          <Results summary={result.summary} elapsedMs={result.elapsedMs} params={result.params} />
        ) : (
          <Card>
            <EmptyState
              icon={<FlaskConical />}
              title="Hypothetical ecosystems"
              description="Simulate thousands of possible futures of the tree under your strategy rules. Results are statistical illustrations, never predictions."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function Results({
  summary,
  elapsedMs,
  params,
}: {
  summary: SimulationSummary;
  elapsedMs: number;
  params: SimulationParams;
}) {
  const f = useFormat();
  const tiles: [string, string][] = [
    ["Median BANK", f.money(Math.round(summary.bank.median))],
    ["Mean BANK", f.money(Math.round(summary.bank.mean))],
    [
      "P25 · P75",
      `${f.money(Math.round(summary.bank.p25), { compact: true })} · ${f.money(Math.round(summary.bank.p75), { compact: true })}`,
    ],
    [
      "P90 · P95",
      `${f.money(Math.round(summary.bank.p90), { compact: true })} · ${f.money(Math.round(summary.bank.p95), { compact: true })}`,
    ],
    ["P(extinct)", f.ratio(summary.probabilityExtinct)],
    ["P(BANK > injected)", f.ratio(summary.probabilityProfit)],
    ["Median alive branches", f.num(summary.medianSurvivingBranches)],
    ["Median branches created", f.num(summary.medianTotalBranches)],
  ];
  return (
    <>
      {summary.evPerTicket <= 0 ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-fg">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          Expected value per ticket is {f.ratio(summary.evPerTicket)} (
          {f.ratio(params.winProbability)} × {f.odds(params.averageOddsBp)} − 1). With a negative
          edge, no bankroll structure can create value in the long run.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="card px-4 py-3.5">
            <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">
              {label}
            </p>
            <p className="mt-1.5 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader
          title="BANK over time — percentile fan"
          description={`${f.num(summary.runs)} runs in ${(elapsedMs / 1000).toFixed(1)} s · injected ${f.money(summary.injectedCents)} · EV/ticket ${f.ratio(summary.evPerTicket)}`}
        />
        <CardBody>
          <FanChart data={summary.fan} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Probability of reaching a BANK level" />
        <CardBody>
          <ul className="flex flex-col gap-3">
            {summary.probabilityBankAtLeast.map((p) => (
              <li key={p.targetCents} className="flex items-center gap-4">
                <span className="w-28 num text-sm">
                  ≥ {f.money(p.targetCents, { trimZeroCents: true })}
                </span>
                <Progress
                  value={p.probability}
                  color="var(--secured)"
                  className="h-2 flex-1"
                  label={`Probability BANK at least ${p.targetCents / 100}`}
                />
                <span className="w-16 text-right num text-sm">{f.ratio(p.probability)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-fg-subtle">
            Assumptions: independent tickets, constant win probability, uniform odds, no voids. When
            the alive-branch limit is reached, new children are counted in BANK instead of being
            created.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

function FanChart({ data }: { data: SimulationSummary["fan"] }) {
  const f = useFormat();
  const rows = data.map((d) => ({
    day: d.day,
    outer: [d.p10, d.p90],
    inner: [d.p25, d.p75],
    median: d.p50,
  }));
  return (
    <div className="h-[260px]" role="img" aria-label="BANK percentile fan chart over time">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--fg-subtle)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(d: number) => `D${d}`}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "var(--fg-subtle)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => f.money(v, { compact: true })}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active, payload, label }) => {
              const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              if (!active || !row) return null;
              return (
                <div className="rounded-lg border border-border bg-surface-3 px-3 py-2 text-xs shadow-panel">
                  <p className="mb-1 text-fg-muted">Day {label}</p>
                  <p className="num">P90 {f.money(Math.round(row.outer[1] ?? 0))}</p>
                  <p className="num">P75 {f.money(Math.round(row.inner[1] ?? 0))}</p>
                  <p className="num font-medium">Median {f.money(Math.round(row.median))}</p>
                  <p className="num">P25 {f.money(Math.round(row.inner[0] ?? 0))}</p>
                  <p className="num">P10 {f.money(Math.round(row.outer[0] ?? 0))}</p>
                </div>
              );
            }}
          />
          <Area
            dataKey="outer"
            stroke="none"
            fill="var(--secured)"
            fillOpacity={0.08}
            isAnimationActive={false}
          />
          <Area
            dataKey="inner"
            stroke="none"
            fill="var(--secured)"
            fillOpacity={0.16}
            isAnimationActive={false}
          />
          <Line
            dataKey="median"
            stroke="var(--secured)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ul className="mt-2 flex flex-wrap gap-4 text-[11px] text-fg-subtle" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-secured" /> Median
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-secured/30" /> P25–P75
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-secured/10" /> P10–P90
        </li>
      </ul>
    </div>
  );
}
