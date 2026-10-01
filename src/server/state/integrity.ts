import { verifyLedger } from "@/domain/branches/metrics";
import { DEFAULT_SETTINGS, type StrategySettings } from "@/domain/strategy/settings";
import { isRootCode } from "@/domain/branches/codes";
import { REAL_INITIAL_SEED_CENTS, type Workspace } from "@/domain/types";
import { REPLAYED_FIELDS, replayBranch } from "./replay";
import {
  freshInitialFunding,
  STATE_FORMAT,
  STATE_SCHEMA_VERSION,
  workspaceStateSchema,
  type BranchEventRecord,
  type WorkspaceState,
} from "./schema";

export function createEmptyState(
  workspace: Workspace,
  now: Date = new Date(),
  settings: StrategySettings = DEFAULT_SETTINGS,
): WorkspaceState {
  return {
    format: STATE_FORMAT,
    schemaVersion: STATE_SCHEMA_VERSION,
    workspace,
    strategyVersion: settings.strategyVersion,
    savedAt: now.toISOString(),
    settings: structuredClone(settings),
    settingsHistory: [],
    branches: [],
    bets: [],
    bankTransactions: [],
    branchEvents: [],
    candidates: [],
    archive: [],
    auditLog: [],
    metadata: {
      createdAt: now.getTime(),
      nextEventId: 1,
      strategyRevision: 0,
      mutationCount: 0,
      demoSeed: null,
      lastChange: null,
      reservedCodes: [],
      initialFunding: freshInitialFunding(),
    },
  };
}

export class StateIntegrityError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Workspace state rejected: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "…" : ""}`,
    );
    this.name = "StateIntegrityError";
  }
}

const MAX_PROBLEMS = 50;

/**
 * Full structural + business integrity check. Run before every write (and on every load):
 * an invalid state is never written over a valid state.json.
 */
export function findIntegrityProblems(input: unknown, expected: Workspace): string[] {
  return checkState(input, expected).problems;
}

function checkState(
  input: unknown,
  expected: Workspace,
): { state: WorkspaceState | null; problems: string[] } {
  const parsed = workspaceStateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      state: null,
      problems: parsed.error.issues
        .slice(0, MAX_PROBLEMS)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const state = reserveExistingCodes(parsed.data);
  const problems: string[] = [];
  const add = (message: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push(message);
  };

  if (state.workspace !== expected) {
    add(`File belongs to the ${state.workspace} workspace, not ${expected}`);
  }
  if (state.workspace === "REAL" && state.metadata.demoSeed !== null) {
    add("REAL workspace contains demo data marker");
  }
  if (state.workspace === "REAL") {
    const funding = state.metadata.initialFunding;
    if (funding.amountCents !== REAL_INITIAL_SEED_CENTS) {
      add("REAL initial funding must be the 100.00 seed");
    }
    const hasRootHistory =
      state.branches.some((b) => b.parentId === null) ||
      state.archive.some((a) => a.branches.some((b) => b.parentId === null)) ||
      state.metadata.reservedCodes.some((c) => isRootCode(c));
    if (!funding.consumed && (hasRootHistory || funding.rootBranchId !== null)) {
      add("REAL external funding is marked unused although a root branch exists or existed");
    }
  }
  if (state.strategyVersion !== state.settings.strategyVersion) {
    add("strategyVersion does not match the settings");
  }

  const unique = (label: string, values: (string | number)[]) => {
    const seen = new Set<string | number>();
    for (const v of values) {
      if (seen.has(v)) add(`Duplicate ${label}: ${v}`);
      seen.add(v);
    }
  };
  unique(
    "branch id",
    state.branches.map((b) => b.id),
  );
  unique(
    "branch code",
    state.branches.map((b) => b.code),
  );
  unique(
    "ticket id",
    state.bets.map((b) => b.id),
  );
  unique(
    "BANK transaction id",
    state.bankTransactions.map((t) => t.id),
  );
  unique(
    "event id",
    state.branchEvents.map((e) => e.id),
  );
  unique(
    "candidate id",
    state.candidates.map((c) => c.id),
  );

  const branches = new Map(state.branches.map((b) => [b.id, b]));
  const bets = new Map(state.bets.map((b) => [b.id, b]));

  for (const b of state.branches) {
    if (b.parentId) {
      const parent = branches.get(b.parentId);
      if (!parent) add(`Branch ${b.code}: parent missing (orphan)`);
      else if (b.generation !== parent.generation + 1) add(`Branch ${b.code}: wrong generation`);
      if (!b.birthBetId) add(`Branch ${b.code}: child without birth ticket`);
    } else if (b.birthReason !== "ROOT") {
      add(`Branch ${b.code}: non-root branch without parent`);
    }
    if (b.birthBetId) {
      const bet = bets.get(b.birthBetId);
      if (!bet) add(`Branch ${b.code}: birth ticket missing`);
      else if (bet.branchId !== b.parentId) add(`Branch ${b.code}: birth ticket not on its parent`);
    }
    if (b.status === "DEAD" && b.currentCapitalCents !== 0)
      add(`Branch ${b.code}: dead with capital`);
  }

  const pendingPerBranch = new Map<string, number>();
  for (const bet of state.bets) {
    if (!branches.has(bet.branchId)) add(`Ticket ${bet.id}: branch missing`);
    if (bet.result === "PENDING" && bet.cancelledAt === null) {
      pendingPerBranch.set(bet.branchId, (pendingPerBranch.get(bet.branchId) ?? 0) + 1);
    }
  }
  for (const [branchId, n] of pendingPerBranch) {
    if (n > 1) add(`Branch ${branches.get(branchId)?.code ?? branchId}: ${n} pending tickets`);
  }

  const bankByBranch = new Map<string, number>();
  for (const t of state.bankTransactions) {
    if (!branches.has(t.branchId))
      add(`BANK transaction ${t.id}: branch missing (phantom BANK money)`);
    if (t.relatedBetId && !bets.has(t.relatedBetId))
      add(`BANK transaction ${t.id}: ticket missing`);
    if ((t.status === "WITHDRAWN") !== (t.withdrawnAt !== null))
      add(`BANK transaction ${t.id}: inconsistent withdrawal`);
    bankByBranch.set(t.branchId, (bankByBranch.get(t.branchId) ?? 0) + t.amountCents);
  }

  const childCapital = new Map<string, number>();
  const childNumber = new Map<string, number>();
  for (const b of state.branches) {
    if (!b.parentId) continue;
    childCapital.set(b.parentId, (childCapital.get(b.parentId) ?? 0) + b.birthCapitalCents);
    childNumber.set(b.parentId, (childNumber.get(b.parentId) ?? 0) + 1);
  }

  const eventsByBranch = new Map<string, BranchEventRecord[]>();
  for (const e of state.branchEvents) {
    if (!branches.has(e.branchId)) add(`Event ${e.id}: branch missing`);
    if (e.relatedBetId && !bets.has(e.relatedBetId)) add(`Event ${e.id}: ticket missing`);
    if (e.relatedBranchId && !branches.has(e.relatedBranchId))
      add(`Event ${e.id}: related branch missing`);
    if (e.id >= state.metadata.nextEventId) add(`Event ${e.id}: id beyond the sequence`);
    const list = eventsByBranch.get(e.branchId);
    if (list) list.push(e);
    else eventsByBranch.set(e.branchId, [e]);
  }

  for (const b of state.branches) {
    const events = (eventsByBranch.get(b.id) ?? []).sort((x, y) => x.id - y.id);
    if (!verifyLedger(events, b.currentCapitalCents).balanced) {
      add(`Branch ${b.code}: capital is not explained by its events`);
    }
    if ((bankByBranch.get(b.id) ?? 0) !== b.totalBankGeneratedCents) {
      add(`Branch ${b.code}: BANK total does not match its transactions`);
    }
    if ((childCapital.get(b.id) ?? 0) !== b.totalChildCapitalGeneratedCents) {
      add(`Branch ${b.code}: child capital total does not match its children`);
    }
    if ((childNumber.get(b.id) ?? 0) > b.childCount) add(`Branch ${b.code}: child counter too low`);
    const replayed = replayBranch(b, events);
    for (const field of REPLAYED_FIELDS) {
      if (replayed[field] !== b[field])
        add(`Branch ${b.code}: ${field} is not explained by its events`);
    }
  }

  for (const c of state.candidates) {
    if (c.convertedBetId && !bets.has(c.convertedBetId)) add(`Candidate ${c.id}: ticket missing`);
  }
  return { state, problems };
}

/**
 * Make sure every branch code present in the file (live or archived) is in the registry of
 * reserved codes. Files written before the registry existed are upgraded transparently.
 */
function reserveExistingCodes(state: WorkspaceState): WorkspaceState {
  const reserved = new Set(state.metadata.reservedCodes);
  const missing = [
    ...state.branches.map((b) => b.code),
    ...state.archive.flatMap((a) => a.branches.map((b) => b.code)),
  ].filter((code) => !reserved.has(code) && reserved.add(code));
  if (missing.length === 0 && reserved.size === state.metadata.reservedCodes.length) return state;
  return { ...state, metadata: { ...state.metadata, reservedCodes: [...reserved] } };
}

/** Validate and return the parsed state, or throw with every problem found. */
export function assertStateIntegrity(input: unknown, expected: Workspace): WorkspaceState {
  const { state, problems } = checkState(input, expected);
  if (!state || problems.length > 0) throw new StateIntegrityError(problems);
  return state;
}
