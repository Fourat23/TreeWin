"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  History,
  Locate,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormat } from "@/components/providers/format-provider";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import {
  DEAD_HEX,
  PROFILE_COLOR_VAR,
  PROFILE_HEX,
  PROFILE_LABEL,
  STATUS_LABEL,
} from "@/lib/labels";
import type { BranchSummaryDTO } from "@/server/queries/dto";
import { BranchNode, NODE_HEIGHT, NODE_WIDTH, type BranchFlowNode } from "./branch-node";
import { GraphLegend } from "./graph-legend";
import { GraphToolbar } from "./graph-toolbar";
import { layoutTree, type Orientation } from "./tree-layout";
import {
  computeVisibleGraph,
  DEFAULT_FILTERS,
  maxSizeValue,
  nodeScale,
  snapshotAt,
  type GraphFilters,
  type HistoryEvent,
  type SizeMode,
} from "./tree-model";

const NODE_TYPES = { branch: BranchNode };

export function TreeView({ branches }: { branches: BranchSummaryDTO[] }) {
  if (branches.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No branch yet"
          description="Create a root branch from the dashboard, or load the demo data, to see the tree grow."
        />
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <TreeCanvas branches={branches} />
    </ReactFlowProvider>
  );
}

interface HoverState {
  branch: BranchSummaryDTO;
  x: number;
  y: number;
  /** Container width at hover time, to keep the tooltip inside the canvas. */
  width: number;
}

function TreeCanvas({ branches: liveBranches }: { branches: BranchSummaryDTO[] }) {
  const f = useFormat();
  const { openBranch, selectedBranch } = useUi();
  const flow = useReactFlow();
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("TB");
  const [sizeMode, setSizeMode] = useState<SizeMode>("NORMAL");
  const [hover, setHover] = useState<HoverState | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [historyIndex, setHistoryIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Remember which branches existed before the latest refresh to animate newcomers.
  const [known, setKnown] = useState(() => ({
    ids: new Set(liveBranches.map((b) => b.id)),
    fresh: new Set<string>(),
  }));
  const unseen = liveBranches.filter((b) => !known.ids.has(b.id));
  if (unseen.length > 0) {
    setKnown({
      ids: new Set(liveBranches.map((b) => b.id)),
      fresh: new Set(unseen.map((b) => b.id)),
    });
  }
  const newIds = known.fresh;

  const historical = history !== null;
  const branches = useMemo(
    () => (history ? snapshotAt(liveBranches, history, historyIndex) : liveBranches),
    [liveBranches, history, historyIndex],
  );

  const resolvedFocus = focusId && branches.some((b) => b.id === focusId) ? focusId : null;
  const visible = useMemo(
    () => computeVisibleGraph(branches, { filters, collapsed, focusId: resolvedFocus }),
    [branches, filters, collapsed, resolvedFocus],
  );

  const onToggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { nodes, edges } = useMemo(() => {
    const maxValue = maxSizeValue(branches, sizeMode);
    const scales = new Map(
      visible.map((v) => [v.branch.id, nodeScale(v.branch, sizeMode, maxValue)]),
    );
    const positions = layoutTree(
      visible.map((v) => ({
        id: v.branch.id,
        parentId: v.branch.parentId,
        code: v.branch.code,
        scale: scales.get(v.branch.id) ?? 1,
      })),
      { orientation, nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT, gapX: 36, gapY: 72 },
    );
    const visibleIds = new Set(visible.map((v) => v.branch.id));
    const flowNodes: BranchFlowNode[] = visible.map((v) => ({
      id: v.branch.id,
      type: "branch",
      position: positions.get(v.branch.id) ?? { x: 0, y: 0 },
      // Explicit size (known from the scale): lets the minimap and fitView work before measuring.
      width: NODE_WIDTH * (scales.get(v.branch.id) ?? 1),
      height: NODE_HEIGHT * (scales.get(v.branch.id) ?? 1),
      draggable: false,
      connectable: false,
      data: {
        branch: v.branch,
        scale: scales.get(v.branch.id) ?? 1,
        context: v.context,
        searchHit: v.searchHit,
        isNew: newIds.has(v.branch.id),
        hasChildren: v.hasChildren,
        collapsed: collapsed.has(v.branch.id),
        hiddenDescendants: v.hiddenDescendants,
        horizontal: orientation === "LR",
        historical,
        onOpen: openBranch,
        onToggleCollapse,
      },
    }));
    const flowEdges: Edge[] = visible
      .filter((v) => v.branch.parentId && visibleIds.has(v.branch.parentId))
      .map((v) => {
        const dead = v.branch.status === "DEAD";
        return {
          id: `${v.branch.parentId}->${v.branch.id}`,
          source: v.branch.parentId as string,
          target: v.branch.id,
          type: "smoothstep",
          className: newIds.has(v.branch.id) ? "ct-edge-new" : undefined,
          style: {
            stroke: dead
              ? "var(--dead)"
              : `color-mix(in oklab, ${PROFILE_COLOR_VAR[v.branch.profile]} 45%, var(--border-strong))`,
            strokeWidth: 1.5,
            opacity: v.context ? 0.4 : 1,
          },
        };
      });
    return { nodes: flowNodes, edges: flowEdges };
  }, [
    visible,
    branches,
    sizeMode,
    orientation,
    collapsed,
    newIds,
    historical,
    openBranch,
    onToggleCollapse,
  ]);

  // Refit when the structure changes significantly (orientation, focus, filters).
  useEffect(() => {
    const t = window.setTimeout(
      () => void flow.fitView({ padding: 0.2, duration: 350, maxZoom: 1.1 }),
      30,
    );
    return () => window.clearTimeout(t);
  }, [
    flow,
    orientation,
    resolvedFocus,
    filters.status,
    filters.profiles,
    filters.generations,
    sizeMode,
  ]);

  const centerOn = useCallback(
    (query: string) => {
      const q = query.trim().toUpperCase();
      if (!q) return;
      const target =
        nodes.find((n) => n.data.branch.code.toUpperCase() === q) ??
        nodes.find((n) => n.data.branch.code.toUpperCase().includes(q));
      if (!target) return;
      const w = NODE_WIDTH * target.data.scale;
      const h = NODE_HEIGHT * target.data.scale;
      void flow.setCenter(target.position.x + w / 2, target.position.y + h / 2, {
        zoom: 1.1,
        duration: 450,
      });
    },
    [nodes, flow],
  );

  const generations = useMemo(
    () => [...new Set(liveBranches.map((b) => b.generation))].sort((a, b) => a - b),
    [liveBranches],
  );
  const selected = selectedBranch
    ? liveBranches.find((b) => b.id === selectedBranch || b.code === selectedBranch)
    : undefined;

  async function toggleHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    const response = await fetch("/api/tree/history", { cache: "no-store" });
    const data = (await response.json()) as { events: HistoryEvent[] };
    setHistory(data.events);
    setHistoryIndex(Math.max(0, data.events.length - 1));
  }

  const allCollapsibleIds = useMemo(
    () =>
      new Set(liveBranches.filter((b) => b.childCount > 0 && b.parentId !== null).map((b) => b.id)),
    [liveBranches],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        onlyRenderVisibleElements={nodes.length > 250}
        minZoom={0.08}
        maxZoom={2.2}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        onNodeMouseEnter={(event, node) => {
          const rect = containerRef.current?.getBoundingClientRect();
          setHover({
            branch: (node as BranchFlowNode).data.branch,
            x: event.clientX - (rect?.left ?? 0),
            y: event.clientY - (rect?.top ?? 0),
            width: rect?.width ?? 800,
          });
        }}
        onNodeMouseLeave={() => setHover(null)}
        onPaneClick={() => setHover(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          style={{ marginBottom: 128, width: 168, height: 112 }}
          nodeColor={(n) => {
            const b = (n as BranchFlowNode).data.branch;
            return b.status === "DEAD" ? DEAD_HEX : PROFILE_HEX[b.profile];
          }}
          nodeBorderRadius={6}
          maskColor="rgba(11, 13, 17, 0.55)"
          className="hidden! md:block!"
        />
      </ReactFlow>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
        <GraphToolbar
          filters={filters}
          onChange={setFilters}
          generations={generations}
          onSearchSubmit={centerOn}
        >
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
              variant="ghost"
              size="icon-sm"
              onClick={() => setOrientation((o) => (o === "TB" ? "LR" : "TB"))}
              aria-label={orientation === "TB" ? "Horizontal layout" : "Vertical layout"}
              title="Toggle orientation"
            >
              {orientation === "TB" ? <MoveHorizontal /> : <MoveVertical />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed(new Set())}
              aria-label="Expand all"
              title="Expand all"
            >
              <ChevronsUpDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed(new Set(allCollapsibleIds))}
              aria-label="Collapse all sub-branches"
              title="Collapse all"
            >
              <ChevronsDownUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void flow.fitView({ padding: 0.2, duration: 400, maxZoom: 1.1 })}
              aria-label="Fit view"
              title="Fit view"
            >
              <Maximize2 />
            </Button>
            <Button
              variant={historical ? "outline" : "ghost"}
              size="sm"
              onClick={() => void toggleHistory()}
              aria-pressed={historical}
            >
              <History /> History
            </Button>
          </div>
        </GraphToolbar>

        {selected || resolvedFocus ? (
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 self-start rounded-xl border border-border bg-surface/90 px-2 py-1.5 text-xs backdrop-blur">
            {resolvedFocus ? (
              <>
                <Target className="size-3.5 text-fg-muted" />
                <span className="text-fg-muted">
                  Lineage focus:{" "}
                  <span className="font-mono font-semibold text-fg">
                    {liveBranches.find((b) => b.id === resolvedFocus)?.code}
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setFocusId(null)}>
                  <X /> Clear
                </Button>
              </>
            ) : selected ? (
              <>
                <span className="font-mono font-semibold text-fg">{selected.code}</span>
                <Button variant="ghost" size="sm" onClick={() => setFocusId(selected.id)}>
                  <Target /> Focus lineage
                </Button>
                <Button variant="ghost" size="sm" onClick={() => centerOn(selected.code)}>
                  <Locate /> Center
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {history ? (
        <HistorySlider events={history} index={historyIndex} onChange={setHistoryIndex} />
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] md:max-w-[60%]">
        <GraphLegend />
      </div>

      {hover ? (
        <div
          className="pointer-events-none absolute z-20 hidden w-56 rounded-xl border border-border bg-surface-3 p-3 text-xs shadow-panel md:block"
          style={{
            left: Math.min(hover.x + 16, hover.width - 240),
            top: hover.y + 16,
          }}
          role="tooltip"
        >
          <p className="font-mono text-sm font-semibold">{hover.branch.code}</p>
          <p className="mt-0.5 text-fg-muted">
            {PROFILE_LABEL[hover.branch.profile]} · {STATUS_LABEL[hover.branch.status]}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-fg-subtle">Capital</dt>
            <dd className="text-right num">{f.money(hover.branch.currentCapitalCents)}</dd>
            <dt className="text-fg-subtle">{f.roundLabel}</dt>
            <dd className="text-right num">{f.round(hover.branch.roundCount)}</dd>
            <dt className="text-fg-subtle">BANK</dt>
            <dd className="text-right num">{f.money(hover.branch.totalBankGeneratedCents)}</dd>
            <dt className="text-fg-subtle">Children</dt>
            <dd className="text-right num">{hover.branch.childCount}</dd>
            <dt className="text-fg-subtle">Lifetime</dt>
            <dd className="text-right num">{f.money(hover.branch.ltvCents)}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function HistorySlider({
  events,
  index,
  onChange,
}: {
  events: HistoryEvent[];
  index: number;
  onChange: (index: number) => void;
}) {
  const f = useFormat();
  const current = events[index];
  if (events.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-16 z-10 mx-auto max-w-2xl rounded-xl border border-border bg-surface/95 px-4 py-3 backdrop-blur md:bottom-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-fg">Time travel</span>
        <span className="num text-fg-muted">
          Event {index + 1} / {events.length}
          {current ? ` · ${f.dateTime(current.createdAt)}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={events.length - 1}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--fg)]"
        aria-label="Event index"
      />
      <p className="mt-1 text-[11px] text-fg-subtle">
        Capital and status of each branch as recorded right after this event.
      </p>
    </div>
  );
}
