import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyLedger } from "@/domain/branches/metrics";
import { branchEvents, branches } from "../db/schema";
import { getDashboard } from "../queries/overview";
import { getBranchDetail, getLineage } from "../queries/branches";
import { listTickets, ticketFiltersSchema } from "../queries/tickets";
import {
  bankCsv,
  branchesCsv,
  exportBackup,
  importBackup,
  isDatabaseEmpty,
  ticketsCsv,
  validateBackup,
} from "./backup-service";
import { seedDemoData } from "./demo-seed";
import { DomainError } from "./errors";
import { getSettings } from "./settings-service";
import { setupTestDb } from "./test-helpers";

const NOW = new Date("2026-10-01T12:00:00");

function seeded() {
  const handle = setupTestDb();
  seedDemoData(handle.db, NOW);
  return handle;
}

describe("demo seed", () => {
  it("builds a demonstrative tree with every status and profile", () => {
    const { db } = seeded();
    const rows = db.select().from(branches).orderBy(asc(branches.code)).all();
    const byCode = Object.fromEntries(rows.map((b) => [b.code, b]));
    expect(Object.keys(byCode).sort()).toEqual([
      "A",
      "A1",
      "A2",
      "A2.1",
      "B",
      "B1",
      "B2",
      "B3",
      "C",
    ]);
    expect(byCode.A?.status).toBe("ACTIVE");
    expect(byCode.A1?.status).toBe("DEAD");
    expect(byCode.B?.status).toBe("MATURE");
    expect(new Set(rows.map((b) => b.profile))).toEqual(new Set(["HARVEST", "BALANCED", "GROWTH"]));
    for (const branch of rows) {
      const events = db
        .select()
        .from(branchEvents)
        .where(eq(branchEvents.branchId, branch.id))
        .orderBy(asc(branchEvents.id))
        .all();
      expect(verifyLedger(events, branch.currentCapitalCents).balanced).toBe(true);
    }
  });

  it("refuses to seed a non-empty database", () => {
    const { db } = seeded();
    expect(() => seedDemoData(db, NOW)).toThrow(DomainError);
  });

  it("feeds the read models", () => {
    const { db } = seeded();
    const dashboard = getDashboard(db, NOW);
    expect(dashboard.isEmpty).toBe(false);
    expect(dashboard.branchCounts).toMatchObject({ total: 9, dead: 3, mature: 1 });
    expect(dashboard.totals.ecosystemCents).toBe(
      dashboard.totals.bankCents + dashboard.totals.activeCapitalCents,
    );
    expect(dashboard.tickets.pending).toBe(3);
    expect(dashboard.bankSeries.at(-1)?.cumulativeCents).toBe(dashboard.totals.bankCents);

    const detail = getBranchDetail(db, "A", getSettings(db));
    expect(detail?.ledger.balanced).toBe(true);
    expect(detail?.children.map((c) => c.code)).toEqual(["A1", "A2"]);
    expect(detail?.pendingBetId).not.toBeNull();

    const lineage = getLineage(db, "A2");
    expect(lineage?.ancestors.map((a) => a.code)).toEqual(["A"]);
    expect(lineage?.descendants.map((d) => d.code)).toEqual(["A2.1"]);

    const list = listTickets(db, ticketFiltersSchema.parse({ status: "LOST" }));
    expect(list.total).toBe(3);
    const search = listTickets(db, ticketFiltersSchema.parse({ q: "getafe" }));
    expect(search.rows.map((r) => r.eventName)).toEqual(["Real Madrid - Getafe"]);
  });
});

describe("backup", () => {
  it("round-trips every row through export and import", () => {
    const source = seeded();
    const backup = JSON.parse(JSON.stringify(exportBackup(source.db, NOW)));

    const target = setupTestDb();
    expect(isDatabaseEmpty(target.db)).toBe(true);
    const counts = importBackup(target.db, backup);
    expect(counts.branches).toBe(9);

    const again = JSON.parse(JSON.stringify(exportBackup(target.db, NOW)));
    expect(again.branches).toEqual(backup.branches);
    expect(again.bets).toEqual(backup.bets);
    expect(again.bankTransactions).toEqual(backup.bankTransactions);
    expect(again.branchEvents).toEqual(backup.branchEvents);
    expect(again.candidates).toEqual(backup.candidates);
  });

  it("rejects malformed or inconsistent backups without touching the database", () => {
    const source = seeded();
    const backup = JSON.parse(JSON.stringify(exportBackup(source.db, NOW)));
    expect(() => validateBackup({ ...backup, format: "other" })).toThrow(DomainError);

    const tampered = structuredClone(backup);
    tampered.branches[0].currentCapitalCents += 1;
    expect(() => validateBackup(tampered)).toThrow(/integrity/);

    const orphan = structuredClone(backup);
    orphan.bets[0].branchId = "missing";
    const target = setupTestDb();
    expect(() => importBackup(target.db, orphan)).toThrow(DomainError);
    expect(isDatabaseEmpty(target.db)).toBe(true);
  });

  it("exports CSV files with a header and decimal amounts", () => {
    const { db } = seeded();
    const tickets = ticketsCsv(db);
    expect(tickets.startsWith("﻿id,branch,profile,round")).toBe(true);
    expect(tickets).toContain(",1.30,100.00,130.00,WON,");
    expect(branchesCsv(db).split("\r\n").filter(Boolean)).toHaveLength(10);
    expect(bankCsv(db)).toContain(",100.00,HARVEST,P1,");
  });
});
