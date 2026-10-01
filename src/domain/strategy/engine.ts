import { childCode } from "../branches/codes";
import { pickChildProfile, type ProfileCounts } from "../branches/profile-picker";
import {
  applyBp,
  calculateReturn,
  formatMoney,
  formatMultiple,
  formatOdds,
  type Cents,
  type OddsBp,
} from "../money";
import type {
  BankTxType,
  BranchEventType,
  BranchStatus,
  HarvestKind,
  Profile,
  SettleResult,
} from "../types";
import { isMilestoneReached, nextMilestone, type Milestone } from "./milestones";
import { getProfileRules, type StrategySettings } from "./settings";

/**
 * Deterministic rules engine.
 *
 * `evaluateSettlement` turns (branch state, ticket, result, settings) into a complete plan:
 * new capital, status, counters, BANK transfers, children to create and the events that
 * explain every cent. It performs no I/O — persistence happens afterwards, in one DB
 * transaction, by applying the plan verbatim. The same engine powers the settlement
 * preview and the Monte Carlo simulation.
 *
 * Win evaluation order:
 *   1. capital = capital − stake + stake × odds (real ticket odds, cent-rounded)
 *   2. ACTIVE branches: at most ONE milestone per round — P1 if not done yet, otherwise the
 *      next profile threshold strictly below the cap
 *   3. ACTIVE branches reaching the cap become MATURE; MATURE branches keep their principal
 *      at the cap and split the excess (mature.bankShareBp to BANK, the rest to a child).
 */

export interface BranchState {
  code: string;
  profile: Profile;
  status: BranchStatus;
  birthCapitalCents: Cents;
  currentCapitalCents: Cents;
  capCents: Cents;
  p1Done: boolean;
  thresholdLevel: number;
  wins: number;
  losses: number;
  voids: number;
  roundCount: number;
  /** Number of direct children already created (codes are never reused). */
  childCount: number;
}

export interface TicketState {
  roundNumber: number;
  stakeCents: Cents;
  oddsBp: OddsBp;
}

export interface EngineContext {
  /** Existing automatically-created branches per profile, for QUOTA assignment. */
  profileCounts: ProfileCounts;
  /** Child profiles explicitly chosen by the user, consumed in creation order. */
  childProfileOverrides?: readonly (Profile | null | undefined)[];
  /** RNG in [0, 1) for RANDOM assignment. Defaults to Math.random. */
  random?: () => number;
  /** Skip human-readable descriptions (Monte Carlo runs evaluate millions of rounds). */
  quiet?: boolean;
  /**
   * Rank of the first child this settlement may create. The ledger passes the next rank not yet
   * reserved by any code ever assigned, so codes are never reused. Defaults to childCount + 1.
   */
  firstChildRank?: number;
}

export interface PlannedEvent {
  type: BranchEventType;
  /** Informative magnitude shown in the UI (always ≥ 0). */
  amountCents: Cents | null;
  /** Signed effect on the branch capital (0 for marker events). */
  capitalDeltaCents: Cents;
  capitalAfterCents: Cents;
  statusAfter: BranchStatus;
  description: string;
  metadata: Record<string, unknown>;
  /** Index into `children` when the event concerns a planned child. */
  childIndex?: number;
}

export interface PlannedBankTransfer {
  amountCents: Cents;
  type: BankTxType;
  harvestKind: HarvestKind;
}

export interface PlannedChild {
  code: string;
  profile: Profile;
  capitalCents: Cents;
  reason: HarvestKind;
}

export interface HarvestSummary {
  kind: HarvestKind;
  /** Threshold that fired (P1/THRESHOLD) or the cap (MATURE_PROFIT). */
  thresholdCents: Cents;
  /** Capital (or excess for MATURE_PROFIT) the split was computed on. */
  baseCents: Cents;
  capitalBeforeCents: Cents;
  bankCents: Cents;
  childCents: Cents;
  remainingCents: Cents;
  childIndex: number | null;
  childRedirectedToBank: boolean;
  level: number | null;
}

export interface SettlementPlan {
  result: SettleResult;
  actualReturnCents: Cents;
  profitLossCents: Cents;
  /** Capital right after the ticket, before any harvest. Stored on the ticket. */
  capitalAfterBetCents: Cents;
  /** Capital of the branch once every rule has been applied. */
  finalCapitalCents: Cents;
  status: BranchStatus;
  p1Done: boolean;
  thresholdLevel: number;
  wins: number;
  losses: number;
  voids: number;
  roundCount: number;
  countsAsRound: boolean;
  matured: boolean;
  died: boolean;
  bankTransfers: PlannedBankTransfer[];
  children: PlannedChild[];
  harvests: HarvestSummary[];
  events: PlannedEvent[];
  totalBankCents: Cents;
  totalChildCapitalCents: Cents;
  /** Capital lost by this ticket (stake of a lost ticket). */
  lostCents: Cents;
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_STATUS" | "INVALID_STAKE" | "INVALID_ODDS",
  ) {
    super(message);
    this.name = "EngineError";
  }
}

function assertSettleable(branch: BranchState, ticket: TicketState): void {
  if (branch.status !== "ACTIVE" && branch.status !== "MATURE") {
    throw new EngineError(`Branch ${branch.code} is ${branch.status}`, "INVALID_STATUS");
  }
  if (!Number.isSafeInteger(ticket.stakeCents) || ticket.stakeCents <= 0) {
    throw new EngineError("Stake must be a positive amount", "INVALID_STAKE");
  }
  if (ticket.stakeCents > branch.currentCapitalCents) {
    throw new EngineError("Stake exceeds the branch capital", "INVALID_STAKE");
  }
  if (!Number.isSafeInteger(ticket.oddsBp) || ticket.oddsBp <= 10_000) {
    throw new EngineError("Odds must be greater than 1.00", "INVALID_ODDS");
  }
}

class PlanBuilder {
  readonly events: PlannedEvent[] = [];
  readonly bankTransfers: PlannedBankTransfer[] = [];
  readonly children: PlannedChild[] = [];
  readonly harvests: HarvestSummary[] = [];
  private readonly counts: ProfileCounts;

  constructor(
    private readonly branch: BranchState,
    private readonly settings: StrategySettings,
    private readonly ctx: EngineContext,
    public capital: Cents,
    public status: BranchStatus,
  ) {
    this.counts = { ...ctx.profileCounts };
  }

  money(cents: Cents, signed = false): string {
    if (this.ctx.quiet) return "";
    return formatMoney(cents, {
      locale: this.settings.locale,
      currency: this.settings.currency,
      signed,
    });
  }

  push(event: Omit<PlannedEvent, "capitalAfterCents" | "statusAfter">): void {
    this.capital += event.capitalDeltaCents;
    this.events.push({ ...event, capitalAfterCents: this.capital, statusAfter: this.status });
  }

  private nextChildProfile(): Profile {
    const override = this.ctx.childProfileOverrides?.[this.children.length];
    const profile =
      override ??
      pickChildProfile({
        mode: this.settings.childProfileAssignment,
        distribution: this.settings.profileDistribution,
        counts: this.counts,
        parentProfile: this.branch.profile,
        random: this.ctx.random,
      });
    this.counts[profile] += 1;
    return profile;
  }

  /** Execute one split: marker, BANK transfer, child creation, summary. */
  harvest(input: {
    kind: HarvestKind;
    thresholdCents: Cents;
    baseCents: Cents;
    bankCents: Cents;
    childCents: Cents;
    level: number | null;
    title: string;
  }): void {
    let { bankCents, childCents } = input;
    let childRedirectedToBank = false;
    if (childCents > 0 && childCents < this.settings.minChildCapitalCents) {
      bankCents += childCents;
      childCents = 0;
      childRedirectedToBank = true;
    }
    const capitalBefore = this.capital;
    const remaining = capitalBefore - bankCents - childCents;
    const metadata = {
      kind: input.kind,
      level: input.level,
      thresholdCents: input.thresholdCents,
      baseCents: input.baseCents,
      capitalBeforeCents: capitalBefore,
      bankCents,
      childCents,
      remainingCents: remaining,
      childRedirectedToBank,
    };

    this.push({
      type: "HARVEST",
      amountCents: bankCents + childCents,
      capitalDeltaCents: 0,
      description: input.title,
      metadata,
    });

    if (bankCents > 0) {
      this.bankTransfers.push({
        amountCents: bankCents,
        type: input.kind === "MATURE_PROFIT" ? "MATURE_PROFIT" : "HARVEST",
        harvestKind: input.kind,
      });
      this.push({
        type: "BANK_TRANSFER",
        amountCents: bankCents,
        capitalDeltaCents: -bankCents,
        description: `${this.money(bankCents, true)} secured to BANK${
          childRedirectedToBank ? " (child share below minimum, redirected to BANK)" : ""
        }`,
        metadata: { kind: input.kind, bankTransferIndex: this.bankTransfers.length - 1 },
      });
    }

    let childIndex: number | null = null;
    if (childCents > 0) {
      childIndex = this.children.length;
      const profile = this.nextChildProfile();
      const firstRank = this.ctx.firstChildRank ?? this.branch.childCount + 1;
      const code = childCode(this.branch.code, firstRank + childIndex);
      this.children.push({ code, profile, capitalCents: childCents, reason: input.kind });
      this.push({
        type: "CHILD_CREATED",
        amountCents: childCents,
        capitalDeltaCents: -childCents,
        description: `Created ${code} (${profile.toLowerCase()}) with ${this.money(childCents)}`,
        metadata: { kind: input.kind, childCode: code, childProfile: profile },
        childIndex,
      });
    }

    this.push({
      type: "SPLIT",
      amountCents: bankCents + childCents,
      capitalDeltaCents: 0,
      description: `Split — BANK ${this.money(bankCents)} · child ${this.money(childCents)} · ${
        this.branch.code
      } continues with ${this.money(this.capital)}`,
      metadata,
      childIndex: childIndex ?? undefined,
    });

    this.harvests.push({
      kind: input.kind,
      thresholdCents: input.thresholdCents,
      baseCents: input.baseCents,
      capitalBeforeCents: capitalBefore,
      bankCents,
      childCents,
      remainingCents: remaining,
      childIndex,
      childRedirectedToBank,
      level: input.level,
    });
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function finalize(
  builder: PlanBuilder,
  base: Omit<
    SettlementPlan,
    | "events"
    | "bankTransfers"
    | "children"
    | "harvests"
    | "finalCapitalCents"
    | "status"
    | "totalBankCents"
    | "totalChildCapitalCents"
  >,
): SettlementPlan {
  return {
    ...base,
    finalCapitalCents: builder.capital,
    status: builder.status,
    events: builder.events,
    bankTransfers: builder.bankTransfers,
    children: builder.children,
    harvests: builder.harvests,
    totalBankCents: sum(builder.bankTransfers.map((t) => t.amountCents)),
    totalChildCapitalCents: sum(builder.children.map((c) => c.capitalCents)),
  };
}

function roundTag(settings: StrategySettings, ticket: TicketState): string {
  return `${settings.roundShortLabel}${ticket.roundNumber}`;
}

function harvestTitle(milestone: Milestone, capital: Cents, b: PlanBuilder): string {
  switch (milestone.kind) {
    case "P1":
      return `P1 reached at ${b.money(capital)} (trigger ${b.money(milestone.thresholdCents)})`;
    case "THRESHOLD":
      return `Threshold ${formatMultiple(milestone.multipleBp)}×S reached at ${b.money(capital)} (≥ ${b.money(
        milestone.thresholdCents,
      )})`;
    default:
      return `Harvest at ${b.money(capital)}`;
  }
}

export function evaluateBranchAfterWin(
  branch: BranchState,
  ticket: TicketState,
  settings: StrategySettings,
  ctx: EngineContext,
): SettlementPlan {
  assertSettleable(branch, ticket);
  const actualReturn = calculateReturn(ticket.stakeCents, ticket.oddsBp);
  const profit = actualReturn - ticket.stakeCents;
  const wins = branch.wins + 1;
  const roundCount = branch.roundCount + 1;
  const b = new PlanBuilder(branch, settings, ctx, branch.currentCapitalCents, branch.status);

  b.push({
    type: "BET_WON",
    amountCents: profit,
    capitalDeltaCents: profit,
    description: `${roundTag(settings, ticket)} won @${formatOdds(ticket.oddsBp)} — ${b.money(profit, true)}`,
    metadata: { stakeCents: ticket.stakeCents, oddsBp: ticket.oddsBp, returnCents: actualReturn },
  });
  const capitalAfterBet = b.capital;

  let p1Done = branch.p1Done || !settings.p1.enabled;
  let thresholdLevel = branch.thresholdLevel;
  let matured = false;
  const capCents = branch.capCents;

  if (branch.status === "ACTIVE") {
    // V1 rule: at most ONE milestone per won round — P1 if still pending, otherwise at most
    // one profile threshold. A branch that is still above the next threshold harvests it on
    // a later won round; there is never a cascade of harvests from a single ticket.
    const milestone = nextMilestone(
      {
        profile: branch.profile,
        status: "ACTIVE",
        birthCapitalCents: branch.birthCapitalCents,
        currentCapitalCents: b.capital,
        capCents,
        p1Done,
        thresholdLevel,
        wins,
      },
      settings,
    );
    if (isMilestoneReached(milestone, b.capital, wins)) {
      if (milestone.kind === "P1") {
        b.harvest({
          kind: "P1",
          thresholdCents: milestone.thresholdCents,
          baseCents: branch.birthCapitalCents,
          bankCents: milestone.bankCents,
          childCents: milestone.childCents,
          level: null,
          title: harvestTitle(milestone, b.capital, b),
        });
        p1Done = true;
      } else if (milestone.kind === "THRESHOLD") {
        const rules = getProfileRules(settings, branch.profile);
        const base = b.capital;
        b.harvest({
          kind: "THRESHOLD",
          thresholdCents: milestone.thresholdCents,
          baseCents: base,
          bankCents: applyBp(base, rules.bankShareBp),
          childCents: applyBp(base, rules.childShareBp),
          level: milestone.level,
          title: harvestTitle(milestone, base, b),
        });
        thresholdLevel += 1;
      }
      // CAP is handled below.
    }

    if (b.capital >= capCents) {
      matured = true;
      b.status = "MATURE";
      b.push({
        type: "CAP_REACHED",
        amountCents: capCents,
        capitalDeltaCents: 0,
        description: `Cap ${b.money(capCents)} reached — ${branch.code} is now MATURE`,
        metadata: { capCents, capitalCents: b.capital },
      });
    }
  }

  if (b.status === "MATURE" && b.capital > capCents) {
    const excess = b.capital - capCents;
    const bankCents = applyBp(excess, settings.mature.bankShareBp);
    b.harvest({
      kind: "MATURE_PROFIT",
      thresholdCents: capCents,
      baseCents: excess,
      bankCents,
      childCents: excess - bankCents,
      level: null,
      title: `Profit above cap: ${b.money(excess)} (principal stays at ${b.money(capCents)})`,
    });
  }

  return finalize(b, {
    result: "WON",
    actualReturnCents: actualReturn,
    profitLossCents: profit,
    capitalAfterBetCents: capitalAfterBet,
    p1Done,
    thresholdLevel,
    wins,
    losses: branch.losses,
    voids: branch.voids,
    roundCount,
    countsAsRound: true,
    matured,
    died: false,
    lostCents: 0,
  });
}

export function evaluateBranchAfterLoss(
  branch: BranchState,
  ticket: TicketState,
  settings: StrategySettings,
  ctx: EngineContext,
): SettlementPlan {
  assertSettleable(branch, ticket);
  const b = new PlanBuilder(branch, settings, ctx, branch.currentCapitalCents, branch.status);
  const remaining = branch.currentCapitalCents - ticket.stakeCents;
  const died = remaining === 0;
  b.push({
    type: "BET_LOST",
    amountCents: ticket.stakeCents,
    capitalDeltaCents: -ticket.stakeCents,
    description: `${roundTag(settings, ticket)} lost @${formatOdds(ticket.oddsBp)} — ${b.money(
      -ticket.stakeCents,
      true,
    )}`,
    metadata: { stakeCents: ticket.stakeCents, oddsBp: ticket.oddsBp },
  });
  if (died) {
    b.status = "DEAD";
    b.push({
      type: "DEATH",
      amountCents: ticket.stakeCents,
      capitalDeltaCents: 0,
      description: `${branch.code} died in ${roundTag(settings, ticket)} — ${b.money(
        ticket.stakeCents,
      )} lost`,
      metadata: {
        roundsPlayed: branch.roundCount + 1,
        wins: branch.wins,
        birthCapitalCents: branch.birthCapitalCents,
        lostCents: ticket.stakeCents,
      },
    });
  }
  return finalize(b, {
    result: "LOST",
    actualReturnCents: 0,
    profitLossCents: -ticket.stakeCents,
    capitalAfterBetCents: remaining,
    p1Done: branch.p1Done,
    thresholdLevel: branch.thresholdLevel,
    wins: branch.wins,
    losses: branch.losses + 1,
    voids: branch.voids,
    roundCount: branch.roundCount + 1,
    countsAsRound: true,
    matured: false,
    died,
    lostCents: ticket.stakeCents,
  });
}

export function evaluateBranchAfterVoid(
  branch: BranchState,
  ticket: TicketState,
  settings: StrategySettings,
  ctx: EngineContext,
): SettlementPlan {
  assertSettleable(branch, ticket);
  const b = new PlanBuilder(branch, settings, ctx, branch.currentCapitalCents, branch.status);
  const countsAsRound = settings.voidCountsAsRound;
  b.push({
    type: "BET_VOID",
    amountCents: ticket.stakeCents,
    capitalDeltaCents: 0,
    description: `${roundTag(settings, ticket)} void — stake ${b.money(ticket.stakeCents)} returned${
      countsAsRound ? "" : " (round not counted)"
    }`,
    metadata: { stakeCents: ticket.stakeCents, oddsBp: ticket.oddsBp, countsAsRound },
  });
  return finalize(b, {
    result: "VOID",
    actualReturnCents: ticket.stakeCents,
    profitLossCents: 0,
    capitalAfterBetCents: branch.currentCapitalCents,
    p1Done: branch.p1Done,
    thresholdLevel: branch.thresholdLevel,
    wins: branch.wins,
    losses: branch.losses,
    voids: branch.voids + 1,
    roundCount: branch.roundCount + (countsAsRound ? 1 : 0),
    countsAsRound,
    matured: false,
    died: false,
    lostCents: 0,
  });
}

export function evaluateSettlement(
  branch: BranchState,
  ticket: TicketState,
  result: SettleResult,
  settings: StrategySettings,
  ctx: EngineContext,
): SettlementPlan {
  switch (result) {
    case "WON":
      return evaluateBranchAfterWin(branch, ticket, settings, ctx);
    case "LOST":
      return evaluateBranchAfterLoss(branch, ticket, settings, ctx);
    case "VOID":
      return evaluateBranchAfterVoid(branch, ticket, settings, ctx);
  }
}

/** Default stake suggested for a new round: everything for ACTIVE, the cap for MATURE. */
export function suggestedStakeCents(
  branch: Pick<BranchState, "status" | "currentCapitalCents" | "capCents">,
): Cents {
  if (branch.status === "MATURE") return Math.min(branch.capCents, branch.currentCapitalCents);
  return branch.currentCapitalCents;
}
