import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { ancestorsOf, buildTreeIndex, descendantsOf } from "@/domain/branches/lineage";
import { bestWinStreak, branchRoiBp, verifyLedger, winRate } from "@/domain/branches/metrics";
import { formatMoney, formatMultiple, type Cents } from "@/domain/money";
import { suggestedStakeCents } from "@/domain/strategy/engine";
import { nextMilestone, planP1 } from "@/domain/strategy/milestones";
import type { StrategySettings } from "@/domain/strategy/settings";
import { isPlayable, type BranchStatus } from "@/domain/types";
import type { DbOrTx } from "../db/client";
import { bankTransactions, bets, branchEvents, branches, type BranchRow } from "../db/schema";
import { findBranchByIdOrCode } from "../services/internal";
import type { BranchDetailDTO, BranchSummaryDTO, MilestoneDTO, PlayableBranchDTO } from "./dto";
import { toBankDTO, toBetDTO, toBranchSummary, toEventDTO } from "./mappers";

export type BranchIndex = Map<string, Pick<BranchRow, "code" | "profile">>;

export function loadBranchIndex(db: DbOrTx): BranchIndex {
  const rows = db
    .select({ id: branches.id, code: branches.code, profile: branches.profile })
    .from(branches)
    .all();
  return new Map(rows.map((r) => [r.id, { code: r.code, profile: r.profile }]));
}

function pendingBranchIds(db: DbOrTx): Set<string> {
  const rows = db
    .select({ branchId: bets.branchId })
    .from(bets)
    .where(and(eq(bets.result, "PENDING"), isNull(bets.cancelledAt)))
    .all();
  return new Set(rows.map((r) => r.branchId));
}

export function listBranchSummaries(db: DbOrTx): BranchSummaryDTO[] {
  const pending = pendingBranchIds(db);
  return db
    .select()
    .from(branches)
    .orderBy(asc(branches.createdAt))
    .all()
    .map((row) => toBranchSummary(row, pending.has(row.id)));
}

const DAY_MS = 86_400_000;

function describeMilestone(row: BranchRow, settings: StrategySettings): MilestoneDTO {
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
  db: DbOrTx,
  idOrCode: string,
  settings: StrategySettings,
  now = Date.now(),
): BranchDetailDTO | null {
  const row = findBranchByIdOrCode(db, idOrCode);
  if (!row) return null;
  const index = loadBranchIndex(db);
  const pending = pendingBranchIds(db);

  const betRows = db
    .select()
    .from(bets)
    .where(eq(bets.branchId, row.id))
    .orderBy(asc(bets.sequence))
    .all();
  const eventRows = db
    .select()
    .from(branchEvents)
    .where(eq(branchEvents.branchId, row.id))
    .orderBy(asc(branchEvents.id))
    .all();
  const bankRows = db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.branchId, row.id))
    .orderBy(desc(bankTransactions.createdAt))
    .all();
  const childRows = db
    .select()
    .from(branches)
    .where(eq(branches.parentId, row.id))
    .orderBy(asc(branches.createdAt))
    .all();
  const parentRow = row.parentId
    ? db.select().from(branches).where(eq(branches.id, row.parentId)).get()
    : undefined;

  const allTree = db
    .select({ id: branches.id, parentId: branches.parentId, status: branches.status })
    .from(branches)
    .all();
  const descendants = descendantsOf(buildTreeIndex(allTree), row.id);

  const live = betRows.filter((b) => !b.cancelledAt);
  const decided = live.filter((b) => b.result === "WON" || b.result === "LOST");
  const avgOddsBp =
    decided.length > 0
      ? Math.round(decided.reduce((sum, b) => sum + b.oddsBp, 0) / decided.length)
      : null;
  const betById = new Map(betRows.map((b) => [b.id, b]));
  const summary = toBranchSummary(row, pending.has(row.id));
  const end = row.diedAt?.getTime() ?? now;

  return {
    branch: { ...summary, notes: row.notes },
    parent: parentRow
      ? {
          id: parentRow.id,
          code: parentRow.code,
          profile: parentRow.profile,
          status: parentRow.status,
        }
      : null,
    children: childRows.map((c) => toBranchSummary(c, pending.has(c.id))),
    bets: betRows.map((b) => toBetDTO(b, row)),
    events: eventRows.map((e) => toEventDTO(e, index)),
    bankTransactions: bankRows.map((t) => {
      const bet = t.relatedBetId ? betById.get(t.relatedBetId) : undefined;
      return toBankDTO(t, row.code, bet ?? null);
    }),
    ledger: verifyLedger(eventRows, row.currentCapitalCents),
    stats: {
      winRate: winRate(row.wins, row.losses),
      avgOddsBp,
      bestStreak: bestWinStreak(live.map((b) => b.result)),
      roiBp: branchRoiBp(summary.ltvCents, row.birthCapitalCents),
      descendants: descendants.length,
      aliveDescendants: descendants.filter((d) => d.status !== "DEAD").length,
      lifespanDays: Math.max(0, Math.floor((end - row.createdAt.getTime()) / DAY_MS)),
    },
    milestone: describeMilestone(row, settings),
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

export function getLineage(db: DbOrTx, idOrCode: string): LineageDTO | null {
  const row = findBranchByIdOrCode(db, idOrCode);
  if (!row) return null;
  const all = listBranchSummaries(db);
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
export function listPlayableBranches(db: DbOrTx): PlayableBranchDTO[] {
  const pending = pendingBranchIds(db);
  return db
    .select()
    .from(branches)
    .where(or(eq(branches.status, "ACTIVE"), eq(branches.status, "MATURE")))
    .orderBy(asc(branches.code))
    .all()
    .filter((b) => isPlayable(b.status) && !pending.has(b.id))
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

export function getTreeHistory(db: DbOrTx): TreeHistoryDTO {
  const rows = db
    .select({
      id: branchEvents.id,
      branchId: branchEvents.branchId,
      createdAt: branchEvents.createdAt,
      capitalAfterCents: branchEvents.capitalAfterCents,
      statusAfter: branchEvents.statusAfter,
    })
    .from(branchEvents)
    .where(
      inArray(branchEvents.type, [
        "BIRTH",
        "BET_WON",
        "BET_LOST",
        "BANK_TRANSFER",
        "CHILD_CREATED",
        "CAP_REACHED",
        "DEATH",
        "MANUAL_ADJUSTMENT",
        "STATUS_CHANGED",
      ]),
    )
    .orderBy(asc(branchEvents.id))
    .all();
  return {
    events: rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
  };
}
