import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/strategy/settings";
import { markWithdrawn, setBankDestination, undoWithdrawn } from "../services/bank-service";
import {
  changeBranchProfile,
  createRootBranch,
  transferToBank,
  updateBranchNotes,
} from "../services/branch-service";
import {
  archiveCandidate,
  createCandidate,
  updateCandidate,
  type CandidateInput,
} from "../services/candidate-service";
import { saveSettings } from "../services/settings-service";
import { unarchiveCandidate } from "../services/unarchive-service";
import { buildDemoState } from "../services/demo-seed";
import { StateIntegrityError } from "./integrity";
import { FileStateRepository, StateLoadError, type MutationContext } from "./repository";
import type { WorkspaceState } from "./schema";

const candidateInput: CandidateInput = {
  eventDate: "2026-10-04",
  sport: "Football",
  competition: "Ligue 1",
  eventName: "Nice - Brest",
  marketName: "1N2",
  selection: "Nice",
  oddsObservedBp: 12_500,
  protocolStatus: "WATCH",
};

let dir: string;
let repo: FileStateRepository;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "celltree-test-"));
  repo = new FileStateRepository(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const read = (path: string) => fs.readFile(path, "utf8");
const exists = (path: string) =>
  fs.access(path).then(
    () => true,
    () => false,
  );

describe("workspaces", () => {
  it("a fresh REAL workspace is empty and reading it writes nothing", async () => {
    const state = await repo.load("REAL");
    expect(state).toMatchObject({
      workspace: "REAL",
      branches: [],
      bets: [],
      bankTransactions: [],
    });
    expect(state.metadata.demoSeed).toBeNull();
    expect(await exists(repo.paths("REAL").state)).toBe(false);
    expect(await exists(repo.paths("DEMO").state)).toBe(false);
  });

  it("REAL and DEMO live in separate files and never see each other's data", async () => {
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "HARVEST", capitalCents: 10_000 }, ctx),
    );
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Initialized DEMO data");
    expect(repo.paths("REAL").state).toBe(join(dir, "real", "state.json"));
    expect(repo.paths("DEMO").state).toBe(join(dir, "demo", "state.json"));
    const real = await repo.load("REAL");
    const demo = await repo.load("DEMO");
    expect(real.branches.map((b) => b.code)).toEqual(["A"]);
    expect(demo.branches.length).toBeGreaterThan(5);
    const demoIds = new Set(demo.branches.map((b) => b.id));
    expect(real.branches.some((b) => demoIds.has(b.id))).toBe(false);
  });

  it("resetting DEMO leaves the REAL file byte-for-byte untouched", async () => {
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "HARVEST", capitalCents: 10_000 }, ctx),
    );
    const before = await read(repo.paths("REAL").state);
    const statBefore = await fs.stat(repo.paths("REAL").state);
    const realBackups = await repo.listBackups("REAL");
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Initialized DEMO data");
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Reset DEMO data");
    expect(await read(repo.paths("REAL").state)).toBe(before);
    expect((await fs.stat(repo.paths("REAL").state)).mtimeMs).toBe(statBefore.mtimeMs);
    expect(await repo.listBackups("REAL")).toEqual(realBackups);
  });

  it("rejects a file that belongs to the other workspace", async () => {
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Initialized DEMO data");
    await fs.mkdir(repo.paths("REAL").dir, { recursive: true });
    await fs.copyFile(repo.paths("DEMO").state, repo.paths("REAL").state);
    await expect(repo.load("REAL")).rejects.toBeInstanceOf(StateLoadError);
  });

  it("refuses demo data in REAL", async () => {
    const demo = buildDemoState(new Date()).state;
    await expect(
      repo.replace("REAL", { ...demo, workspace: "REAL" }, "nope"),
    ).rejects.toBeInstanceOf(StateIntegrityError);
    expect(await exists(repo.paths("REAL").state)).toBe(false);
  });
});

describe("atomic persistence", () => {
  it("writes valid, versioned JSON through a temporary file", async () => {
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "GROWTH", capitalCents: 10_000 }, ctx),
    );
    const raw = JSON.parse(await read(repo.paths("REAL").state));
    expect(raw).toMatchObject({
      format: "celltree-state",
      schemaVersion: 1,
      workspace: "REAL",
      strategyVersion: "1.0",
    });
    expect(await exists(join(repo.paths("REAL").dir, "state.tmp"))).toBe(false);
  });

  it("an invalid change never replaces state.json (and leaves no snapshot)", async () => {
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "GROWTH", capitalCents: 10_000 }, ctx),
    );
    const before = await read(repo.paths("REAL").state);
    const backupsBefore = await repo.listBackups("REAL");
    await expect(
      repo.mutate(
        "REAL",
        (s) => {
          (s.branches[0] as { currentCapitalCents: number }).currentCapitalCents = 999_999; // phantom money
        },
        { label: "corrupt" },
      ),
    ).rejects.toBeInstanceOf(StateIntegrityError);
    expect(await read(repo.paths("REAL").state)).toBe(before);
    expect(await repo.listBackups("REAL")).toEqual(backupsBefore);
  });

  it("a throwing operation leaves the state untouched", async () => {
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "GROWTH", capitalCents: 10_000 }, ctx),
    );
    const before = await read(repo.paths("REAL").state);
    await expect(
      repo.mutate("REAL", (s, ctx) => {
        updateBranchNotes(s, { branchId: s.branches[0]?.id ?? "", notes: "lost" }, ctx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await read(repo.paths("REAL").state)).toBe(before);
  });

  it("serialises concurrent mutations of a workspace", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        repo.mutate("DEMO", (s, ctx) =>
          createRootBranch(s, { profile: "HARVEST", capitalCents: 1_000 }, ctx),
        ),
      ),
    );
    expect((await repo.load("DEMO")).branches.map((b) => b.code)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });

  it("hands out immutable states", async () => {
    const state = await repo.load("REAL");
    expect(() => state.branches.push({} as never)).toThrow();
  });
});

describe("snapshots, restore & undo", () => {
  const codes = async (ws: "REAL" | "DEMO" = "REAL") =>
    (await repo.load(ws)).branches.map((b) => b.code);
  const notes = async () => (await repo.load("REAL")).branches.map((b) => b.notes);
  const addRoot = (label: string) =>
    repo.mutate(
      "REAL",
      (s, ctx) => createRootBranch(s, { profile: "HARVEST", capitalCents: 10_000 }, ctx),
      {
        label,
      },
    );
  const editNotes = (text: string) =>
    repo.mutate(
      "REAL",
      (s, ctx) => updateBranchNotes(s, { branchId: s.branches[0]?.id ?? "", notes: text }, ctx),
      { label: `Edited notes: ${text}` },
    );

  it("every persisted mutation gets its own snapshot and becomes the last change", async () => {
    await addRoot("Created A");
    await editNotes("first");
    const state = await repo.load("REAL");
    expect(state.metadata.lastChange?.label).toBe("Edited notes: first");
    const backups = await repo.listBackups("REAL");
    expect(backups.map((b) => b.reason)).toEqual([
      "Before: Edited notes: first",
      "Before: Created A",
    ]);
    expect(state.auditLog.map((e) => e.label)).toEqual(["Created A", "Edited notes: first"]);
  });

  it("Undo after a major change then a small edit only reverts the small edit", async () => {
    await addRoot("Created A");
    await repo.mutate(
      "REAL",
      (s, ctx) =>
        transferToBank(
          s,
          { branchId: s.branches[0]?.id ?? "", amountCents: 2_000, reason: "secure" },
          ctx,
        ),
      { label: "Secured 20 € to BANK" },
    ); // major mutation A
    await editNotes("typo"); // small edit B
    expect(await repo.undo("REAL")).toBe("Edited notes: typo");
    const state = await repo.load("REAL");
    expect(state.bankTransactions).toHaveLength(1); // the major change is kept
    expect(state.branches[0]?.currentCapitalCents).toBe(8_000);
    expect(await notes()).toEqual([null]); // only the note edit is gone
    expect(state.metadata.lastChange?.label).toBe("Secured 20 € to BANK");
  });

  it("repeated Undo reverses one mutation at a time", async () => {
    await addRoot("Created A");
    await editNotes("one");
    await editNotes("two");
    await editNotes("three");
    expect(await notes()).toEqual(["three"]);
    expect(await repo.undo("REAL")).toBe("Edited notes: three");
    expect(await notes()).toEqual(["two"]);
    expect(await repo.undo("REAL")).toBe("Edited notes: two");
    expect(await notes()).toEqual(["one"]);
    expect(await repo.undo("REAL")).toBe("Edited notes: one");
    expect(await notes()).toEqual([null]);
    expect(await repo.undo("REAL")).toBe("Created A");
    expect(await codes()).toEqual([]);
    expect(await repo.undo("REAL")).toBeNull();
    const log = (await repo.load("REAL")).auditLog.map((e) => e.label);
    expect(log.at(-1)).toBe("Undo: Created A");
  });

  it("every kind of mutation is an undo point, undone one step at a time", async () => {
    const strip = (st: WorkspaceState) =>
      JSON.stringify({ ...st, savedAt: null, auditLog: null, metadata: null });
    const steps: [string, (s: WorkspaceState, ctx: MutationContext) => unknown][] = [
      [
        "create root",
        (s, ctx) => createRootBranch(s, { profile: "BALANCED", capitalCents: 10_000 }, ctx),
      ],
      [
        "branch notes",
        (s, ctx) => updateBranchNotes(s, { branchId: s.branches[0]?.id ?? "", notes: "n" }, ctx),
      ],
      ["candidate", (s, ctx) => createCandidate(s, candidateInput, ctx)],
      [
        "candidate edit",
        (s, ctx) => updateCandidate(s, { id: s.candidates[0]?.id ?? "", notes: "edited" }, ctx),
      ],
      ["candidate archive", (s, ctx) => archiveCandidate(s, s.candidates[0]?.id ?? "", ctx)],
      [
        "candidate unarchive",
        (s, ctx) => unarchiveCandidate(s, { id: s.candidates[0]?.id ?? "" }, ctx),
      ],
      [
        "manual BANK transfer",
        (s, ctx) =>
          transferToBank(
            s,
            { branchId: s.branches[0]?.id ?? "", amountCents: 500, reason: "secure" },
            ctx,
          ),
      ],
      [
        "mark withdrawn",
        (s, ctx) => markWithdrawn(s, { transactionIds: [s.bankTransactions[0]?.id ?? ""] }, ctx),
      ],
      [
        "BANK destination",
        (s) =>
          setBankDestination(s, {
            transactionIds: [s.bankTransactions[0]?.id ?? ""],
            destination: "PEA",
          }),
      ],
      [
        "undo withdrawn",
        (s) => undoWithdrawn(s, { transactionIds: [s.bankTransactions[0]?.id ?? ""] }),
      ],
      ["settings", (s, ctx) => saveSettings(s, { ...s.settings, roundLabel: "Tour" }, ctx)],
      [
        "profile change",
        (s, ctx) =>
          changeBranchProfile(
            s,
            { branchId: s.branches[0]?.id ?? "", profile: "GROWTH", reason: "test" },
            ctx,
          ),
      ],
    ];
    const before: string[] = [];
    for (const [label, fn] of steps) {
      before.push(strip(await repo.load("REAL")));
      await repo.mutate("REAL", fn, { label });
    }
    expect((await repo.load("REAL")).auditLog.map((e) => e.label)).toEqual(steps.map(([l]) => l));
    for (const [label] of [...steps].reverse()) {
      expect(await repo.undo("REAL")).toBe(label);
      expect(strip(await repo.load("REAL"))).toBe(before.pop());
    }
    expect(await repo.undo("REAL")).toBeNull();
  });

  it("an undone state stays recoverable from the backup history", async () => {
    await addRoot("Created A");
    await editNotes("keep me");
    await repo.undo("REAL");
    const safety = (await repo.listBackups("REAL")).find(
      (b) => b.reason === "Before undo: Edited notes: keep me",
    );
    expect(safety).toBeDefined();
    await repo.restore("REAL", safety?.id ?? "");
    expect(await notes()).toEqual(["keep me"]);
    // A restore is itself a change: Undo goes back to the state before the restore.
    await repo.undo("REAL");
    expect(await notes()).toEqual([null]);
  });

  it("Undo in one workspace never touches the other", async () => {
    await addRoot("Created A");
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Initialized DEMO data");
    await repo.mutate(
      "DEMO",
      (s, ctx) => updateBranchNotes(s, { branchId: s.branches[0]?.id ?? "", notes: "demo" }, ctx),
      {
        label: "Demo note",
      },
    );
    const realBefore = await read(repo.paths("REAL").state);
    expect(await repo.undo("DEMO")).toBe("Demo note");
    expect(await repo.undo("DEMO")).toBe("Initialized DEMO data");
    expect(await codes("DEMO")).toEqual([]);
    expect(await read(repo.paths("REAL").state)).toBe(realBefore);
    expect(await codes("REAL")).toEqual(["A"]);
  });

  it("keeps only the newest automatic snapshots; manual backups are never deleted", async () => {
    await repo.mutate(
      "REAL",
      (s, ctx) => {
        s.settings = { ...DEFAULT_SETTINGS, backups: { keepAutomatic: 3 } };
        createRootBranch(s, { profile: "HARVEST", capitalCents: 10_000 }, ctx);
      },
      { label: "setup" },
    );
    const manual = await repo.backup("REAL", "Before the season", "MANUAL");
    let t = Date.now();
    for (let i = 0; i < 6; i += 1) {
      await repo.mutate(
        "REAL",
        (s, ctx) =>
          updateBranchNotes(s, { branchId: s.branches[0]?.id ?? "", notes: `note ${i}` }, ctx),
        { label: `change ${i}`, now: new Date((t += 1_000)) },
      );
    }
    const backups = await repo.listBackups("REAL");
    expect(backups.filter((b) => b.kind === "AUTO")).toHaveLength(3);
    expect(backups.filter((b) => b.kind === "MANUAL").map((b) => b.id)).toEqual([manual?.id]);
    expect(backups.filter((b) => b.kind === "AUTO").map((b) => b.reason)).toEqual([
      "Before: change 5",
      "Before: change 4",
      "Before: change 3",
    ]);
  });

  it("refuses to restore another workspace's snapshot", async () => {
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Initialized DEMO data");
    const info = await repo.backup("DEMO", "demo backup", "MANUAL");
    await fs.mkdir(repo.paths("REAL").backups, { recursive: true });
    await fs.copyFile(
      join(repo.paths("DEMO").backups, `${info?.id}.json`),
      join(repo.paths("REAL").backups, `${info?.id}.json`),
    );
    await expect(repo.restore("REAL", info?.id ?? "")).rejects.toBeInstanceOf(StateLoadError);
    expect(await exists(repo.paths("REAL").state)).toBe(false);
  });
});
