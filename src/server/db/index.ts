import "server-only";
import { openDatabase, runMigrations, type DatabaseHandle, type Db } from "./client";

const globalForDb = globalThis as unknown as { __celltreeDb?: DatabaseHandle };

/**
 * Process-wide database connection for the Next.js server. Migrations are applied on first
 * use so `npm run dev` works on a fresh clone; `npm run db:migrate` does the same explicitly.
 * Cached on globalThis so hot reloads don't leak connections.
 */
export function getDb(): Db {
  if (!globalForDb.__celltreeDb) {
    const handle = openDatabase();
    runMigrations(handle.db);
    globalForDb.__celltreeDb = handle;
  }
  return globalForDb.__celltreeDb.db;
}

export function getDbPath(): string {
  getDb();
  return globalForDb.__celltreeDb?.path ?? "";
}

export type { Db };
