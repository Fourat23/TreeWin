"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Crown, Minus, Pause, Plus, Skull } from "lucide-react";
import { memo } from "react";
import { useFormat } from "@/components/providers/format-provider";
import { PROFILE_COLOR_VAR, PROFILE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { BranchSummaryDTO } from "@/server/queries/dto";

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 96;

export type BranchNodeData = {
  branch: BranchSummaryDTO;
  scale: number;
  context: boolean;
  searchHit: boolean;
  isNew: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  hiddenDescendants: number;
  horizontal: boolean;
  historical: boolean;
  onOpen: (id: string) => void;
  onToggleCollapse: (id: string) => void;
};

export type BranchFlowNode = Node<BranchNodeData, "branch">;

function BranchNodeImpl({ data, selected }: NodeProps<BranchFlowNode>) {
  const f = useFormat();
  const { branch, scale } = data;
  const color = PROFILE_COLOR_VAR[branch.profile];
  const dead = branch.status === "DEAD";
  const mature = branch.status === "MATURE";
  const paused = branch.status === "PAUSED";

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-surface text-left transition-[opacity,box-shadow]",
        data.isNew && "ct-pop-in",
        mature && "ct-halo",
        dead && "ct-dead",
        paused && "border-dashed",
        data.context && "opacity-35",
        selected && "ring-2 ring-fg/70 ring-offset-2 ring-offset-bg",
        data.searchHit && !selected && "ring-2 ring-focus ring-offset-2 ring-offset-bg",
      )}
      style={{
        width: NODE_WIDTH * scale,
        height: NODE_HEIGHT * scale,
        borderColor: dead
          ? "var(--dead)"
          : paused
            ? "var(--paused)"
            : `color-mix(in oklab, ${color} ${mature ? 85 : 55}%, var(--border))`,
        background: dead
          ? "var(--surface)"
          : `linear-gradient(180deg, color-mix(in oklab, ${color} 13%, var(--surface)) 0%, var(--surface) 70%)`,
      }}
    >
      <Handle
        type="target"
        position={data.horizontal ? Position.Left : Position.Top}
        className="pointer-events-none! min-h-0! min-w-0! border-0! bg-transparent!"
        isConnectable={false}
      />
      <button
        type="button"
        onClick={() => data.onOpen(branch.id)}
        className="flex h-full w-full flex-col justify-between rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
        style={{ fontSize: `${Math.max(0.9, scale) * 100}%` }}
        aria-label={`Branch ${branch.code}, ${PROFILE_LABEL[branch.profile]}, ${STATUS_LABEL[branch.status]}, capital ${f.money(
          branch.currentCapitalCents,
        )}`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: dead ? "var(--dead)" : color }}
              aria-hidden
            />
            <span className="truncate font-mono text-[13px] font-semibold text-fg">
              {branch.code}
            </span>
          </span>
          <span className="flex items-center gap-1 text-[10px] text-fg-subtle">
            {mature ? <Crown className="size-3.5 text-mature" aria-label="Mature" /> : null}
            {dead ? <Skull className="size-3.5" aria-label="Dead" /> : null}
            {paused ? <Pause className="size-3.5 text-paused" aria-label="Paused" /> : null}
            <span className="num">{f.round(branch.roundCount)}</span>
          </span>
        </span>
        <span
          className={cn(
            "block truncate num text-[15px] font-semibold tracking-tight",
            dead ? "text-fg-subtle" : "text-fg",
          )}
        >
          {dead
            ? `−${f.money(branch.totalLostCents, { trimZeroCents: true })}`
            : f.money(branch.currentCapitalCents)}
        </span>
        <span className="flex items-center justify-between gap-2 text-[10.5px] text-fg-subtle">
          <span className="truncate">{dead ? "Dead" : PROFILE_LABEL[branch.profile]}</span>
          {!data.historical ? (
            <span className="truncate num">
              BANK {f.money(branch.totalBankGeneratedCents, { trimZeroCents: true })}
            </span>
          ) : null}
        </span>
      </button>
      {data.hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleCollapse(branch.id);
          }}
          className={cn(
            "absolute z-10 flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full border border-border-strong bg-surface-2 px-1 text-[10px] text-fg-muted hover:text-fg",
            data.horizontal
              ? "top-1/2 -right-2.5 -translate-y-1/2"
              : "-bottom-2.5 left-1/2 -translate-x-1/2",
          )}
          aria-label={
            data.collapsed
              ? `Expand ${branch.code} descendants`
              : `Collapse ${branch.code} descendants`
          }
          aria-expanded={!data.collapsed}
        >
          {data.collapsed ? (
            <>
              <Plus className="size-3" />
              <span className="num">{data.hiddenDescendants}</span>
            </>
          ) : (
            <Minus className="size-3" />
          )}
        </button>
      ) : null}
      <Handle
        type="source"
        position={data.horizontal ? Position.Right : Position.Bottom}
        className="pointer-events-none! min-h-0! min-w-0! border-0! bg-transparent!"
        isConnectable={false}
      />
    </div>
  );
}

export const BranchNode = memo(BranchNodeImpl);
