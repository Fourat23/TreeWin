import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/strategy/settings";
import { createTicket, settleTicket } from "../services/bet-service";
import { createRootBranch, updateBranchNotes } from "../services/branch-service";
import { applyCorrection } from "../services/correction-service";
import { buildDemoState } from "../services/demo-seed";
import { DomainError } from "../services/errors";
import { factoryResetReal } from "../services/ledger-service";
import { ticketInput } from "../services/test-helpers";
import { FileStateRepository } from "./repository";
import type { WorkspaceState } from "./schema";

let dir: string;
let repo: FileStateRepository;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "celltree-reset-"));
  repo = new FileStateRepository(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A REAL ledger: A (€100) played to P1 (A1 born), A1 then archived away by a correction. */
async function grownRealLedger(): Promise<WorkspaceState> {
  await repo.mutate("REAL", (s, ctx) =>
    createRootBranch(s, { profile: "BALANCED", capitalCents: 10_000 }, ctx),
  );
  for (let i = 0; i < 4; i += 1) {
    await repo.mutate("REAL", (s, ctx) => {
      const a = s.branches.find((b) => b.code === "A");
      if (!a) throw new Error("missing A");
      const { bet } = createTicket(s, ticketInput(a.id, a.currentCapitalCents, 13_000), ctx);
      settleTicket(s, { betId: bet.id, result: "WON" }, ctx);
    });
  }
  await repo.mutate("REAL", (s, ctx) => {
    const a1 = s.branches.find((b) => b.code === "A1");
    applyCorrection(s, { target: { kind: "DELETE_TICKET", betId: a1?.birthBetId ?? "" } }, ctx);
  });
  return repo.load("REAL");
}

const ledgerOf = (s: WorkspaceState) =>
  JSON.stringify({
    branches: s.branches,
    bets: s.bets,
    bank: s.bankTransactions,
    events: s.branchEvents,
    archive: s.archive,
    candidates: s.candidates,
    funding: s.metadata.initialFunding,
    codes: s.metadata.reservedCodes,
    settingsHistory: s.settingsHistory,
    revision: s.metadata.strategyRevision,
  });

describe("Factory Reset REAL", () => {
  it("requires typing RESET REAL exactly — otherwise nothing changes", async () => {
    await grownRealLedger();
    const before = await fs.readFile(repo.paths("REAL").state, "utf8");
    for (const typed of ["", "reset real", "RESET  REAL", "RESET REAL ", "RESET"]) {
      await expect(factoryResetReal(repo, typed)).rejects.toBeInstanceOf(DomainError);
    }
    expect(await fs.readFile(repo.paths("REAL").state, "utf8")).toBe(before);
    expect((await repo.listBackups("REAL")).some((b) => b.kind === "RECOVERY")).toBe(false);
  });

  it("starts a brand-new ledger: empty, fresh €100 seed, new code namespace", async () => {
    const old = await grownRealLedger();
    expect(old.metadata.reservedCodes).toEqual(["A", "A1"]);
    expect(old.archive).toHaveLength(1);
    await factoryResetReal(repo, "RESET REAL");
    const fresh = await repo.load("REAL");
    expect(fresh).toMatchObject({
      branches: [],
      bets: [],
      bankTransactions: [],
      branchEvents: [],
      candidates: [],
      archive: [],
      settingsHistory: [],
    });
    expect(fresh.metadata.reservedCodes).toEqual([]);
    expect(fresh.metadata.initialFunding).toEqual({
      amountCents: 10_000,
      consumed: false,
      consumedAt: null,
      rootBranchId: null,
    });
    expect(fresh.metadata.strategyRevision).toBe(0);
    expect(fresh.auditLog.map((e) => e.label)).toEqual([
      expect.stringMatching(/^Factory Reset REAL \(previous ledger saved as .+-recovery\)$/),
    ]);
    // The next (and only) manual root is A with the fixed €100 seed again.
    await expect(
      repo.mutate("REAL", (s, ctx) =>
        createRootBranch(s, { profile: "GROWTH", capitalCents: 50_000 }, ctx),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const a = await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "GROWTH", capitalCents: 10_000 }, ctx),
    );
    expect(a.code).toBe("A");
    await expect(
      repo.mutate("REAL", (s, ctx) =>
        createRootBranch(s, { profile: "GROWTH", capitalCents: 10_000 }, ctx),
      ),
    ).rejects.toMatchObject({ code: "FUNDING_LOCKED" });
  });

  it("keeps a recovery snapshot that restores the previous ledger exactly", async () => {
    const old = await grownRealLedger();
    const { recoveryBackupId } = await factoryResetReal(repo, "RESET REAL");
    expect(recoveryBackupId).toMatch(/-recovery$/);
    // The recovery backup survives the automatic retention.
    await repo.mutate(
      "REAL",
      (s) => {
        s.settings = { ...DEFAULT_SETTINGS, backups: { keepAutomatic: 2 } };
      },
      { label: "retention 2" },
    );
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "HARVEST", capitalCents: 10_000 }, ctx),
    );
    for (let i = 0; i < 5; i += 1) {
      await repo.mutate(
        "REAL",
        (s, ctx) =>
          updateBranchNotes(s, { branchId: s.branches[0]?.id ?? "", notes: `n${i}` }, ctx),
        { label: `note ${i}` },
      );
    }
    const backups = await repo.listBackups("REAL");
    expect(backups.filter((b) => b.kind === "AUTO")).toHaveLength(2);
    expect(backups.find((b) => b.id === recoveryBackupId)).toMatchObject({ kind: "RECOVERY" });

    await repo.restore("REAL", recoveryBackupId ?? "");
    const restored = await repo.load("REAL");
    expect(ledgerOf(restored)).toBe(ledgerOf(old));
    // Its funding lock and code namespace are back.
    await expect(
      repo.mutate("REAL", (s, ctx) =>
        createRootBranch(s, { profile: "HARVEST", capitalCents: 10_000 }, ctx),
      ),
    ).rejects.toMatchObject({ code: "FUNDING_LOCKED" });
  });

  it("can also be undone right away", async () => {
    const old = await grownRealLedger();
    await factoryResetReal(repo, "RESET REAL");
    expect(await repo.undo("REAL")).toMatch(/^Factory Reset REAL/);
    expect(ledgerOf(await repo.load("REAL"))).toBe(ledgerOf(old));
  });

  it("never touches DEMO, and DEMO activity never consumes REAL funding", async () => {
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Initialized DEMO data");
    await repo.mutate("DEMO", (s, ctx) =>
      createRootBranch(s, { profile: "HARVEST", capitalCents: 77_700 }, ctx),
    );
    expect((await repo.load("REAL")).metadata.initialFunding.consumed).toBe(false);
    await grownRealLedger();
    const demoState = await fs.readFile(repo.paths("DEMO").state, "utf8");
    const demoBackups = await fs.readdir(repo.paths("DEMO").backups);
    await factoryResetReal(repo, "RESET REAL");
    expect(await fs.readFile(repo.paths("DEMO").state, "utf8")).toBe(demoState);
    expect(await fs.readdir(repo.paths("DEMO").backups)).toEqual(demoBackups);
  });
});
