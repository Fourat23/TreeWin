import { describe, expect, it } from "vitest";
import { createEmptyState, findIntegrityProblems } from "../state/integrity";
import { bankCsv, exportWorkspace, prepareImport, ticketsCsv } from "./backup-service";
import { createRootBranch } from "./branch-service";
import { buildDemoState } from "./demo-seed";
import { DomainError } from "./errors";
import { workspaceHarness } from "./test-helpers";

function realWithData() {
  const h = workspaceHarness("REAL");
  const a = createRootBranch(h.state, { profile: "BALANCED", capitalCents: 10_000 }, h.ctx());
  for (let i = 0; i < 4; i += 1) h.play(a.id, 13_000, "WON");
  return h.state;
}

function rejection(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("IMPORT_REJECTED");
    return error as DomainError;
  }
  throw new Error("expected IMPORT_REJECTED");
}

describe("export / import", () => {
  it("round-trips a REAL export into REAL", () => {
    const state = realWithData();
    const file = JSON.parse(JSON.stringify(exportWorkspace(state)));
    expect(file).toMatchObject({ format: "celltree-backup", kind: "EXPORT", workspace: "REAL" });
    const { state: imported, preview } = prepareImport(file, "REAL");
    expect(preview).toMatchObject({ source: "REAL", target: "REAL", asCopy: false });
    expect(preview.counts).toMatchObject({ branches: 2, tickets: 4, bankTransactions: 1 });
    expect(imported.branches).toEqual(state.branches);
    expect(imported.metadata.lastChange).toBeNull();
  });

  it("never imports a DEMO file into REAL", () => {
    const demo = JSON.parse(JSON.stringify(exportWorkspace(buildDemoState(new Date()).state)));
    const error = rejection(() => prepareImport(demo, "REAL"));
    expect(error.message).toMatch(/DEMO file can never be imported into the REAL workspace/);
    // Even when the file claims to be REAL, demo-seeded content is refused.
    rejection(() =>
      prepareImport(
        { ...demo, workspace: "REAL", state: { ...demo.state, workspace: "REAL" } },
        "REAL",
      ),
    );
  });

  it("imports a REAL file into DEMO only as an explicit copy", () => {
    const file = JSON.parse(JSON.stringify(exportWorkspace(realWithData())));
    rejection(() => prepareImport(file, "DEMO"));
    const { state, preview } = prepareImport(file, "DEMO", { asCopy: true });
    expect(preview.asCopy).toBe(true);
    expect(state.workspace).toBe("DEMO");
    expect(findIntegrityProblems(state, "DEMO")).toEqual([]);
  });

  it("rejects corrupted files with every integrity problem listed", () => {
    const file = JSON.parse(JSON.stringify(exportWorkspace(realWithData())));
    file.state.bankTransactions[0].amountCents += 1; // phantom BANK cent
    const error = rejection(() => prepareImport(file, "REAL"));
    expect((error.details?.problems as string[]).join(" ")).toMatch(/BANK total/);
    rejection(() => prepareImport({ hello: "world" }, "REAL"));
  });

  it("migrates a V1.0 (SQLite era) export", () => {
    const state = realWithData();
    const legacy = {
      format: "celltree-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      migration: "0000_init",
      settings: { currency: "EUR", locale: "fr-FR", roundLabel: "Round", roundShortLabel: "R" },
      settingsHistory: [],
      branches: state.branches.map(({ strategyVersion: _v, strategyRevision: _r, ...b }) => b),
      bets: state.bets.map(({ strategyVersion: _v, strategyRevision: _r, ...b }) => b),
      bankTransactions: state.bankTransactions.map(({ status: _s, withdrawnAt: _w, ...t }) => t),
      branchEvents: state.branchEvents.map((e) =>
        e.type === "BIRTH" ? { ...e, metadata: { reason: e.metadata?.reason } } : e,
      ),
      candidates: [],
    };
    const { state: migrated, preview } = prepareImport(legacy, "REAL");
    expect(preview.source).toBe("LEGACY");
    expect(migrated.bankTransactions[0]).toMatchObject({ status: "SECURED", withdrawnAt: null });
    expect(migrated.branches.map((b) => b.strategyVersion)).toEqual(["1.0", "1.0"]);
    expect(findIntegrityProblems(migrated, "REAL")).toEqual([]);
  });
});

describe("demo seed", () => {
  it("builds a valid DEMO-only state through the real services", () => {
    const { state, summary } = buildDemoState(new Date("2026-10-01T10:00:00"));
    expect(state.workspace).toBe("DEMO");
    expect(state.metadata.demoSeed).not.toBeNull();
    expect(findIntegrityProblems(state, "DEMO")).toEqual([]);
    expect(findIntegrityProblems({ ...state, workspace: "REAL" }, "REAL").join(" ")).toMatch(
      /demo data/,
    );
    expect(summary.branches).toBe(state.branches.length);
    const statuses = new Set(state.branches.map((b) => b.status));
    expect(statuses).toEqual(new Set(["ACTIVE", "MATURE", "DEAD"]));
    expect(state.bankTransactions.some((t) => t.status === "WITHDRAWN")).toBe(true);
    expect(state.bets.some((b) => b.overrideReason !== null)).toBe(true);
    expect(state.bets.filter((b) => b.result === "PENDING")).toHaveLength(3);
  });
});

describe("CSV", () => {
  it("exports tickets and BANK entries with status columns", () => {
    const state = realWithData();
    const tickets = ticketsCsv(state).split("\r\n");
    expect(tickets[0]).toMatch(/^﻿id,branch,profile,round/);
    expect(tickets).toHaveLength(6); // header + 4 tickets + trailing newline
    const bank = bankCsv(state);
    expect(bank).toMatch(/status,withdrawn_at/);
    expect(bank).toMatch(/,SECURED,,UNALLOCATED,/);
    expect(ticketsCsv(createEmptyState("REAL")).split("\r\n")).toHaveLength(2);
  });
});
