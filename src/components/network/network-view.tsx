"use client";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { Maximize2, Shuffle, Snowflake, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTreeIndex, lineageIds } from "@/domain/branches/lineage";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { GraphLegend } from "@/components/tree/graph-legend";
import { GraphToolbar } from "@/components/tree/graph-toolbar";
import {
  computeVisibleGraph,
  DEFAULT_FILTERS,
  maxSizeValue,
  nodeScale,
  type GraphFilters,
  type SizeMode,
} from "@/components/tree/tree-model";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { PROFILE_COLOR_VAR, PROFILE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { BranchSummaryDTO } from "@/server/queries/dto";

interface SimNode extends SimulationNodeDatum {
  id: string;
  generation: number;
  radius: number;
  dead: boolean;
}

type SimLink = SimulationLinkDatum<SimNode> & { id: string };

const RING = 120;

/**
 * Organic view of the ecosystem: parent→child links only, generations on loose concentric
 * rings. Alive branches drift very slightly; dead branches are pinned and never move again.
 */
export function NetworkView({ branches }: { branches: BranchSummaryDTO[] }) {
  if (branches.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No branch yet"
          description="The network appears once the first root branch exists."
        />
      </div>
    );
  }
  return <NetworkCanvas branches={branches} />;
}

function NetworkCanvas({ branches }: { branches: BranchSummaryDTO[] }) {
  const f = useFormat();
  const { openBranch } = useUi();
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [sizeMode, setSizeMode] = useState<SizeMode>("CAPITAL");
  const [frozen, setFrozen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ branch: BranchSummaryDTO; x: number; y: number } | null>(
    null,
  );
  const [zoomK, setZoomK] = useState(1);

  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomInitialized = useRef(false);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef(new Map<string, SimNode>());
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const linkEls = useRef(new Map<string, SVGLineElement>());
  const frozenRef = useRef(frozen);
  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);

  const visible = useMemo(
    () => computeVisibleGraph(branches, { filters, collapsed: new Set(), focusId: null }),
    [branches, filters],
  );
  const maxValue = useMemo(() => maxSizeValue(branches, sizeMode), [branches, sizeMode]);
  const radiusOf = useCallback(
    (b: BranchSummaryDTO) =>
      7 + (9 * (nodeScale(b, sizeMode, maxValue) - 0.8)) / 0.65 + (sizeMode === "NORMAL" ? 3 : 0),
    [sizeMode, maxValue],
  );
  const lineage = useMemo(
    () => (selectedId ? lineageIds(buildTreeIndex(branches), selectedId) : null),
    [branches, selectedId],
  );
  const byId = useMemo(() => new Map(visible.map((v) => [v.branch.id, v.branch])), [visible]);
  const links = useMemo(
    () =>
      visible
        .filter((v) => v.branch.parentId && byId.has(v.branch.parentId))
        .map((v) => ({
          id: `${v.branch.parentId}->${v.branch.id}`,
          source: v.branch.parentId as string,
          target: v.branch.id,
        })),
    [visible, byId],
  );

  // Zoom & pan.
  useEffect(() => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    if (!svg || !viewport) return;
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        viewport.setAttribute("transform", event.transform.toString());
        setZoomK(Math.round(event.transform.k * 10) / 10);
      });
    zoomRef.current = behavior;
    const selection = select(svg);
    selection.call(behavior);
    if (!zoomInitialized.current) {
      // Only once: React may re-run effects (strict mode) and must not reset a fitted view.
      zoomInitialized.current = true;
      const { width, height } = svg.getBoundingClientRect();
      selection.call(behavior.transform, zoomIdentity.translate(width / 2, height / 2).scale(0.9));
    }
    return () => {
      selection.on(".zoom", null);
    };
  }, []);

  const applyPositions = useCallback(() => {
    for (const [id, el] of nodeEls.current) {
      const n = nodesRef.current.get(id);
      if (n) el.setAttribute("transform", `translate(${n.x ?? 0},${n.y ?? 0})`);
    }
    for (const [id, el] of linkEls.current) {
      const [source, target] = id.split("->");
      const s = nodesRef.current.get(source ?? "");
      const t = nodesRef.current.get(target ?? "");
      if (!s || !t) continue;
      el.setAttribute("x1", String(s.x ?? 0));
      el.setAttribute("y1", String(s.y ?? 0));
      el.setAttribute("x2", String(t.x ?? 0));
      el.setAttribute("y2", String(t.y ?? 0));
    }
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    const nodes = [...nodesRef.current.values()];
    if (nodes.length === 0) return;
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    const { width, height } = svg.getBoundingClientRect();
    const k = Math.min(
      1.8,
      0.8 / Math.max((maxX - minX + 80) / width, (maxY - minY + 80) / height),
    );
    select(svg).call(
      behavior.transform,
      zoomIdentity
        .translate(width / 2, height / 2)
        .scale(k)
        .translate(-(minX + maxX) / 2, -(minY + maxY) / 2),
    );
  }, []);

  // (Re)build the simulation when the visible graph changes; positions persist across refreshes.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previous = nodesRef.current;
    const next = new Map<string, SimNode>();
    for (const v of visible) {
      const existing = previous.get(v.branch.id);
      const dead = v.branch.status === "DEAD";
      const parent = v.branch.parentId ? previous.get(v.branch.parentId) : undefined;
      const node: SimNode = existing ?? {
        id: v.branch.id,
        generation: v.branch.generation,
        radius: 0,
        dead,
        x: (parent?.x ?? 0) + (Math.random() - 0.5) * 30,
        y: (parent?.y ?? 0) + (Math.random() - 0.5) * 30,
      };
      node.radius = radiusOf(v.branch);
      node.generation = v.branch.generation;
      // A branch that just died is pinned where it stands.
      if (dead && !node.dead && node.x !== undefined) {
        node.fx = node.x;
        node.fy = node.y;
      }
      node.dead = dead;
      next.set(v.branch.id, node);
    }
    nodesRef.current = next;
    const nodes = [...next.values()];
    const simLinks: SimLink[] = links.map((l) => ({ ...l }));

    simRef.current?.stop();
    const simulation = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => 34 + (l.target as SimNode).radius * 2)
          .strength(0.9),
      )
      .force("charge", forceManyBody<SimNode>().strength(-110).distanceMax(420))
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => d.radius + 6),
      )
      .force("radial", forceRadial<SimNode>((d) => d.generation * RING, 0, 0).strength(0.35))
      .alphaDecay(0.035)
      .on("tick", applyPositions)
      .on("end", () => {
        // Once settled, dead branches never move again.
        for (const n of nodes) {
          if (n.dead && n.fx === undefined) {
            n.fx = n.x;
            n.fy = n.y;
          }
        }
      });

    const firstBuild = previous.size === 0;
    if (firstBuild || reduced || frozenRef.current) {
      // Settle synchronously: no chaotic explosion on load, dead branches pinned from the start.
      simulation.stop();
      for (let i = 0; i < 300; i += 1) simulation.tick();
      for (const n of nodes) if (n.dead) Object.assign(n, { fx: n.x, fy: n.y });
      applyPositions();
      if (firstBuild) fit();
    }
    if (!reduced && !frozenRef.current) {
      // Gentle "breathing": alive, unpinned branches drift by a fraction of a pixel.
      simulation.force("drift", () => {
        for (const n of nodes) {
          if (n.fx !== undefined && n.fx !== null) continue;
          n.vx = (n.vx ?? 0) + (Math.random() - 0.5) * 0.06;
          n.vy = (n.vy ?? 0) + (Math.random() - 0.5) * 0.06;
        }
      });
      simulation
        .alpha(firstBuild ? 0.05 : 0.35)
        .alphaTarget(0.004)
        .restart();
    }
    simRef.current = simulation;
    return () => {
      simulation.stop();
    };
  }, [visible, links, radiusOf, applyPositions, fit]);

  const freeze = () => {
    const sim = simRef.current;
    if (!sim) return;
    if (!frozen) {
      sim.stop();
      for (const n of nodesRef.current.values()) Object.assign(n, { fx: n.x, fy: n.y });
    } else {
      for (const n of nodesRef.current.values())
        if (!n.dead) Object.assign(n, { fx: null, fy: null });
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        sim.alpha(0.2).alphaTarget(0.004).restart();
    }
    setFrozen(!frozen);
  };

  const relayout = () => {
    const sim = simRef.current;
    if (!sim) return;
    for (const n of nodesRef.current.values()) Object.assign(n, { fx: null, fy: null });
    setFrozen(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      for (let i = 0; i < 260; i += 1) sim.tick();
      for (const n of nodesRef.current.values()) if (n.dead) Object.assign(n, { fx: n.x, fy: n.y });
      applyPositions();
    } else {
      sim.alpha(1).alphaTarget(0.004).restart();
    }
  };

  const generations = useMemo(
    () => [...new Set(branches.map((b) => b.generation))].sort((a, b) => a - b),
    [branches],
  );
  const showLabels = zoomK >= 0.7 || visible.length <= 60;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="Network of branches"
        onClick={(e) => {
          if (e.target === svgRef.current) setSelectedId(null);
        }}
      >
        <defs>
          <filter id="ct-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g ref={viewportRef}>
          <g>
            {links.map((l) => {
              const child = byId.get(l.target);
              const inLineage = !lineage || (lineage.has(l.source) && lineage.has(l.target));
              return (
                <line
                  key={l.id}
                  ref={(el) => {
                    if (el) linkEls.current.set(l.id, el);
                    else linkEls.current.delete(l.id);
                  }}
                  stroke={child?.status === "DEAD" ? "var(--dead)" : "var(--border-strong)"}
                  strokeWidth={1.4}
                  opacity={inLineage ? 0.9 : 0.15}
                />
              );
            })}
          </g>
          <g>
            {visible.map(({ branch, context }) => {
              const r = radiusOf(branch);
              const dead = branch.status === "DEAD";
              const mature = branch.status === "MATURE";
              const paused = branch.status === "PAUSED";
              const dim = context || (lineage !== null && !lineage.has(branch.id));
              return (
                <g
                  key={branch.id}
                  ref={(el) => {
                    if (el) nodeEls.current.set(branch.id, el);
                    else nodeEls.current.delete(branch.id);
                  }}
                  className="cursor-pointer"
                  opacity={dim ? 0.2 : 1}
                  tabIndex={0}
                  role="button"
                  aria-label={`Branch ${branch.code}, ${PROFILE_LABEL[branch.profile]}, ${STATUS_LABEL[branch.status]}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(branch.id);
                    openBranch(branch.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(branch.id);
                      openBranch(branch.id);
                    }
                  }}
                  onMouseEnter={(e) => {
                    const rect = svgRef.current?.getBoundingClientRect();
                    setHover({
                      branch,
                      x: e.clientX - (rect?.left ?? 0),
                      y: e.clientY - (rect?.top ?? 0),
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  <g
                    className={cn("ct-pop-in", dead && "ct-dead")}
                    style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  >
                    {mature ? (
                      <circle
                        r={r + 4}
                        fill="none"
                        stroke="var(--mature)"
                        strokeWidth={1.5}
                        opacity={0.9}
                        filter="url(#ct-glow)"
                      />
                    ) : null}
                    <circle
                      r={r}
                      fill={dead ? "var(--dead)" : PROFILE_COLOR_VAR[branch.profile]}
                      stroke={paused ? "var(--paused)" : "var(--bg)"}
                      strokeWidth={2}
                      strokeDasharray={paused ? "3 2" : undefined}
                    />
                    {selectedId === branch.id ? (
                      <circle r={r + 3} fill="none" stroke="var(--fg)" strokeWidth={1.5} />
                    ) : null}
                  </g>
                  {showLabels ? (
                    <text
                      y={r + 12}
                      textAnchor="middle"
                      className="font-mono"
                      fontSize={10}
                      fill={dead ? "var(--fg-subtle)" : "var(--fg-muted)"}
                    >
                      {dead ? `${branch.code} †` : branch.code}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-3 top-3">
        <GraphToolbar filters={filters} onChange={setFilters} generations={generations}>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Select
              aria-label="Node size"
              className="h-8 w-[150px] text-xs"
              value={sizeMode}
              onChange={(e) => setSizeMode(e.target.value as SizeMode)}
            >
              <option value="NORMAL">Size: uniform</option>
              <option value="CAPITAL">Size: capital</option>
              <option value="LIFETIME_VALUE">Size: lifetime value</option>
            </Select>
            <Button
              variant={frozen ? "outline" : "ghost"}
              size="sm"
              onClick={freeze}
              aria-pressed={frozen}
            >
              {frozen ? <Sun /> : <Snowflake />} {frozen ? "Unfreeze" : "Freeze layout"}
            </Button>
            <Button variant="ghost" size="sm" onClick={relayout}>
              <Shuffle /> Re-layout
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={fit}
              aria-label="Fit view"
              title="Fit view"
            >
              <Maximize2 />
            </Button>
          </div>
        </GraphToolbar>
      </div>

      {selectedId ? (
        <p className="pointer-events-none absolute top-20 left-3 rounded-lg border border-border bg-surface/90 px-2.5 py-1 text-xs text-fg-muted">
          Lineage of{" "}
          <span className="font-mono font-semibold text-fg">
            {branches.find((b) => b.id === selectedId)?.code}
          </span>{" "}
          highlighted · click the background to clear
        </p>
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)]">
        <GraphLegend />
      </div>

      {hover ? (
        <div
          className="pointer-events-none absolute z-20 hidden w-52 rounded-xl border border-border bg-surface-3 p-3 text-xs shadow-panel md:block"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
          role="tooltip"
        >
          <p className="font-mono text-sm font-semibold">{hover.branch.code}</p>
          <p className="text-fg-muted">
            {PROFILE_LABEL[hover.branch.profile]} · {STATUS_LABEL[hover.branch.status]}
          </p>
          <p className="mt-1.5 num">{f.money(hover.branch.currentCapitalCents)}</p>
          <p className="text-fg-subtle">
            {f.round(hover.branch.roundCount)} · BANK{" "}
            {f.money(hover.branch.totalBankGeneratedCents)} · {hover.branch.childCount} children
          </p>
        </div>
      ) : null}
    </div>
  );
}
