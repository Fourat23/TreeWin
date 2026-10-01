import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
/** Drizzle transaction handle — same query API as `Db`, all statements synchronous. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the database itself or an open transaction. */
export type DbOrTx = Db | Tx;

export interface DatabaseHandle {
  db: Db;
  sqlite: Database.Database;
  path: string;
}

export const DEFAULT_DB_PATH = "./data/celltree.db";
export const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle");

export function resolveDbPath(): string {
  return process.env.CELLTREE_DB_PATH ?? DEFAULT_DB_PATH;
}

/**
 * Open a SQLite database with safe defaults (WAL, foreign keys enforced).
 * Use ":memory:" for tests.
 */
export function openDatabase(path: string = resolveDbPath()): DatabaseHandle {
  const fullPath = path === ":memory:" ? path : resolve(path);
  if (fullPath !== ":memory:") mkdirSync(dirname(fullPath), { recursive: true });
  const sqlite = new Database(fullPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, path: fullPath };
}

/** Apply pending versioned migrations from ./drizzle (idempotent). */
export function runMigrations(db: Db, migrationsFolder = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
}

/** Fresh migrated in-memory database — used by tests. */
export function createTestDatabase(): DatabaseHandle {
  const handle = openDatabase(":memory:");
  runMigrations(handle.db);
  return handle;
}
