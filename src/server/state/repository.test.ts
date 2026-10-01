import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain/strategy/settings";
import { createRootBranch } from "../services/branch-service";
import { buildDemoState } from "../services/demo-seed";
import { StateIntegrityError } from "./integrity";
import { FileStateRepository, StateLoadError } from "./repository";

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
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Initialized DEMO data");
    await repo.replace("DEMO", buildDemoState(new Date()).state, "Reset DEMO data");
    expect(await read(repo.paths("REAL").state)).toBe(before);
    expect((await fs.stat(repo.paths("REAL").state)).mtimeMs).toBe(statBefore.mtimeMs);
    expect(await repo.listBackups("REAL")).toEqual([]);
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
      createRootBranch(s, { profile: "GROWTH", capitalCents: 5_000 }, ctx),
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
      createRootBranch(s, { profile: "GROWTH", capitalCents: 5_000 }, ctx),
    );
    const before = await read(repo.paths("REAL").state);
    await expect(
      repo.mutate(
        "REAL",
        (s) => {
          (s.branches[0] as { currentCapitalCents: number }).currentCapitalCents = 999_999; // phantom money
        },
        { undoable: "corrupt" },
      ),
    ).rejects.toBeInstanceOf(StateIntegrityError);
    expect(await read(repo.paths("REAL").state)).toBe(before);
    expect(await repo.listBackups("REAL")).toEqual([]);
  });

  it("a throwing operation leaves the state untouched", async () => {
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "GROWTH", capitalCents: 5_000 }, ctx),
    );
    const before = await read(repo.paths("REAL").state);
    await expect(
      repo.mutate("REAL", (s, ctx) => {
        createRootBranch(s, { profile: "GROWTH", capitalCents: 5_000 }, ctx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await read(repo.paths("REAL").state)).toBe(before);
  });

  it("serialises concurrent mutations of a workspace", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        repo.mutate("REAL", (s, ctx) =>
          createRootBranch(s, { profile: "HARVEST", capitalCents: 1_000 }, ctx),
        ),
      ),
    );
    expect((await repo.load("REAL")).branches.map((b) => b.code)).toEqual([
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
  it("snapshots before undoable changes and restores the previous state", async () => {
    await repo.mutate("REAL", (s, ctx) =>
      createRootBranch(s, { profile: "HARVEST", capitalCents: 1_000 }, ctx),
    );
    await repo.mutate(
      "REAL",
      (s, ctx) => createRootBranch(s, { profile: "HARVEST", capitalCents: 2_000 }, ctx),
      { undoable: "Created root branch B" },
    );
    const state = await repo.load("REAL");
    expect(state.metadata.lastChange?.label).toBe("Created root branch B");
    const backups = await repo.listBackups("REAL");
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ kind: "AUTO", reason: "Before: Created root branch B" });

    // Undo = restore the snapshot of the last change; the restore itself is undoable (redo).
    await repo.restore(
      "REAL",
      state.metadata.lastChange?.backupId ?? "",
      "Undo: Created root branch B",
    );
    const undone = await repo.load("REAL");
    expect(undone.branches.map((b) => b.code)).toEqual(["A"]);
    expect(undone.metadata.lastChange?.label).toBe("Undo: Created root branch B");
    await repo.restore("REAL", undone.metadata.lastChange?.backupId ?? "");
    expect((await repo.load("REAL")).branches.map((b) => b.code)).toEqual(["A", "B"]);
  });

  it("keeps only the newest automatic snapshots; manual backups are never deleted", async () => {
    await repo.mutate("REAL", (s, ctx) => {
      s.settings = { ...DEFAULT_SETTINGS, backups: { keepAutomatic: 3 } };
      createRootBranch(s, { profile: "HARVEST", capitalCents: 1_000 }, ctx);
    });
    const manual = await repo.backup("REAL", "Before the season", "MANUAL");
    let t = Date.parse("2026-10-01T10:00:00.000Z");
    for (let i = 0; i < 6; i += 1) {
      await repo.mutate(
        "REAL",
        (s, ctx) => createRootBranch(s, { profile: "HARVEST", capitalCents: 1_000 }, ctx),
        { undoable: `change ${i}`, now: new Date((t += 1_000)) },
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
