import { ancestorsOf, buildTreeIndex, descendantsOf } from "@/domain/branches/lineage";
import { bestWinStreak, branchRoiBp, verifyLedger, winRate } from "@/domain/branches/metrics";
import { formatMoney, formatMultiple, type Cents } from "@/domain/money";
import { suggestedStakeCents } from "@/domain/strategy/engine";
import { nextMilestone, planP1 } from "@/domain/strategy/milestones";
import type { StrategySettings } from "@/domain/strategy/settings";
import { isPlayable, type BranchStatus } from "@/domain/types";
import { findBranchByIdOrCode } from "../services/internal";
import type { BranchRecord, WorkspaceState } from "../state/schema";
import type { BranchDetailDTO, BranchSummaryDTO, MilestoneDTO, PlayableBranchDTO } from "./dto";
import { indexState, toBankDTO, toBetDTO, toBranchSummary, toEventDTO } from "./mappers";

export function listBranchSummaries(state: WorkspaceState): BranchSummaryDTO[] {
  const { pendingBranchIds } = indexState(state);
  return [...state.branches]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((row) => toBranchSummary(row, pendingBranchIds.has(row.id)));
}

const DAY_MS = 86_400_000;

function describeMilestone(row: BranchRecord, settings: StrategySettings): MilestoneDTO {
  const fmt = (c: Cents) =>
    formatMoney(c, { locale: settings.locale, currency: settings.currency });
  const effectiveStatus: BranchStatus =
    row.status === "PAUSED" ? (row.maturedAt ? "MATURE" : "ACTIVE") : row.status;
  if (effectiveStatus === "DEAD") {
    return { kind: "NONE", label: "Dead", detail: "No further milestone — death is final." };
  }
  if (effectiveStatus === "MATURE") {
    return {
      kind: "NONE",
      label: "Mature",
      detail: `Principal held at ${fmt(row.capCents)}; profit above the cap goes ${
        settings.mature.bankShareBp / 100
      } % to BANK, the rest to a new branch.`,
    };
  }
  const milestone = nextMilestone(
    {
      profile: row.profile,
      status: effectiveStatus,
      birthCapitalCents: row.birthCapitalCents,
      currentCapitalCents: row.currentCapitalCents,
      capCents: row.capCents,
      p1Done: row.p1Done,
      thresholdLevel: row.thresholdLevel,
      wins: row.wins,
    },
    settings,
  );
  const progressTo = (target: Cents) =>
    target > 0 ? Math.min(1, row.currentCapitalCents / target) : 0;
  switch (milestone.kind) {
    case "P1": {
      const plan = planP1(row.birthCapitalCents, settings);
      const winsPart =
        milestone.requiredWins !== null ? ` after ${milestone.requiredWins} wins` : "";
      const progress =
        milestone.requiredWins !== null
          ? Math.min(progressTo(milestone.thresholdCents), row.wins / milestone.requiredWins)
          : progressTo(milestone.thresholdCents);
      return {
        kind: "P1",
        label: "P1",
        thresholdCents: milestone.thresholdCents,
        progress,
        detail: `At ${fmt(milestone.thresholdCents)}${winsPart}: ${fmt(plan.bankCents)} to BANK, ${fmt(
          plan.childCents,
        )} to a new branch.`,
      };
    }
    case "THRESHOLD": {
      const rules = settings.profiles[row.profile];
      return {
        kind: "THRESHOLD",
        label: `${formatMultiple(milestone.multipleBp)}×S`,
        thresholdCents: milestone.thresholdCents,
        progress: progressTo(milestone.thresholdCents),
        detail: `At ${fmt(milestone.thresholdCents)}: ${rules.bankShareBp / 100} % BANK, ${
          rules.childShareBp / 100
        } % new branch, ${(10_000 - rules.bankShareBp - rules.childShareBp) / 100} % stays.`,
      };
    }
    case "CAP":
      return {
        kind: "CAP",
        label: "Cap",
        thresholdCents: milestone.thresholdCents,
        progress: progressTo(milestone.thresholdCents),
        detail: `Becomes MATURE at ${fmt(milestone.thresholdCents)}.`,
      };
    case "NONE":
      return { kind: "NONE", label: "—", detail: "" };
  }
}

export function getBranchDetail(
  state: WorkspaceState,
  idOrCode: string,
  now = Date.now(),
): BranchDetailDTO | null {
  const row = findBranchByIdOrCode(state, idOrCode);
  if (!row) return null;
  const { branchById, pendingBranchIds } = indexState(state);

  const betRows = state.bets
    .filter((b) => b.branchId === row.id)
    .sort((a, b) => a.sequence - b.sequence);
  const eventRows = state.branchEvents
    .filter((e) => e.branchId === row.id)
    .sort((a, b) => a.id - b.id);
  const bankRows = state.bankTransactions
    .filter((t) => t.branchId === row.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const childRows = state.branches
    .filter((b) => b.parentId === row.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const parentRow = row.parentId ? branchById.get(row.parentId) : undefined;
  const descendants = descendantsOf(buildTreeIndex(state.branches), row.id);

  const live = betRows.filter((b) => b.cancelledAt === null);
  const decided = live.filter((b) => b.result === "WON" || b.result === "LOST");
  const avgOddsBp =
    decided.length > 0
      ? Math.round(decided.reduce((sum, b) => sum + b.oddsBp, 0) / decided.length)
      : null;
  const betById = new Map(betRows.map((b) => [b.id, b]));
  const summary = toBranchSummary(row, pendingBranchIds.has(row.id));
  const end = row.diedAt ?? now;

  return {
    branch: { ...summary, notes: row.notes, birthBetId: row.birthBetId },
    parent: parentRow
      ? {
          id: parentRow.id,
          code: parentRow.code,
          profile: parentRow.profile,
          status: parentRow.status,
        }
      : null,
    children: childRows.map((c) => toBranchSummary(c, pendingBranchIds.has(c.id))),
    bets: betRows.map((b) => toBetDTO(b, row)),
    events: eventRows.map((e) => toEventDTO(e, branchById)),
    bankTransactions: bankRows.map((t) =>
      toBankDTO(t, row.code, t.relatedBetId ? betById.get(t.relatedBetId) : null),
    ),
    ledger: verifyLedger(eventRows, row.currentCapitalCents),
    stats: {
      winRate: winRate(row.wins, row.losses),
      avgOddsBp,
      bestStreak: bestWinStreak(live.map((b) => b.result)),
      roiBp: branchRoiBp(summary.ltvCents, row.birthCapitalCents),
      descendants: descendants.length,
      aliveDescendants: descendants.filter((d) => d.status !== "DEAD").length,
      lifespanDays: Math.max(0, Math.floor((end - row.createdAt) / DAY_MS)),
    },
    milestone: describeMilestone(row, state.settings),
    suggestedStakeCents: suggestedStakeCents(row),
    pendingBetId: live.find((b) => b.result === "PENDING")?.id ?? null,
  };
}

export interface LineageDTO {
  branch: BranchSummaryDTO;
  ancestors: BranchSummaryDTO[];
  descendants: (BranchSummaryDTO & { depth: number })[];
  stats: {
    size: number;
    aliveCapitalCents: Cents;
    bankCents: Cents;
    alive: number;
    dead: number;
    mature: number;
    rounds: number;
    best: BranchSummaryDTO | null;
  };
}

export function getLineage(state: WorkspaceState, idOrCode: string): LineageDTO | null {
  const row = findBranchByIdOrCode(state, idOrCode);
  if (!row) return null;
  const all = listBranchSummaries(state);
  const index = buildTreeIndex(all);
  const self = index.byId.get(row.id);
  if (!self) return null;
  const ancestors = ancestorsOf(index, row.id);
  const depthOf = new Map<string, number>([[row.id, 0]]);
  const descendants = descendantsOf(index, row.id).map((d) => {
    const depth = (d.parentId ? (depthOf.get(d.parentId) ?? 0) : 0) + 1;
    depthOf.set(d.id, depth);
    return { ...d, depth };
  });
  const members = [...ancestors, self, ...descendants];
  const best = members.reduce<BranchSummaryDTO | null>(
    (top, b) => (!top || b.ltvCents > top.ltvCents ? b : top),
    null,
  );
  return {
    branch: self,
    ancestors,
    descendants,
    stats: {
      size: members.length,
      aliveCapitalCents: members
        .filter((b) => b.status !== "DEAD")
        .reduce((s, b) => s + b.currentCapitalCents, 0),
      bankCents: members.reduce((s, b) => s + b.totalBankGeneratedCents, 0),
      alive: members.filter((b) => b.status !== "DEAD").length,
      dead: members.filter((b) => b.status === "DEAD").length,
      mature: members.filter((b) => b.status === "MATURE").length,
      rounds: members.reduce((s, b) => s + b.roundCount, 0),
      best,
    },
  };
}

/** Branches that can open a new round right now (ACTIVE/MATURE without pending ticket). */
export function listPlayableBranches(state: WorkspaceState): PlayableBranchDTO[] {
  const { pendingBranchIds } = indexState(state);
  return state.branches
    .filter((b) => isPlayable(b.status) && !pendingBranchIds.has(b.id))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((b) => ({
      id: b.id,
      code: b.code,
      profile: b.profile,
      status: b.status,
      currentCapitalCents: b.currentCapitalCents,
      capCents: b.capCents,
      suggestedStakeCents: suggestedStakeCents(b),
      roundCount: b.roundCount,
      nextRoundNumber: b.roundCount + 1,
    }));
}

/** Compact event log for the tree time-travel slider. */
export interface TreeHistoryDTO {
  events: {
    id: number;
    branchId: string;
    createdAt: number;
    capitalAfterCents: number | null;
    statusAfter: BranchStatus | null;
  }[];
}

const HISTORY_TYPES = new Set([
  "BIRTH",
  "BET_WON",
  "BET_LOST",
  "BANK_TRANSFER",
  "CHILD_CREATED",
  "CAP_REACHED",
  "DEATH",
  "MANUAL_ADJUSTMENT",
  "STATUS_CHANGED",
]);

export function getTreeHistory(state: WorkspaceState): TreeHistoryDTO {
  return {
    events: state.branchEvents
      .filter((e) => HISTORY_TYPES.has(e.type))
      .sort((a, b) => a.id - b.id)
      .map((e) => ({
        id: e.id,
        branchId: e.branchId,
        createdAt: e.createdAt,
        capitalAfterCents: e.capitalAfterCents,
        statusAfter: e.statusAfter,
      })),
  };
}
