import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { Workspace } from "@/domain/types";
import { assertStateIntegrity, createEmptyState, StateIntegrityError } from "./integrity";
import {
  BACKUP_FORMAT,
  backupFileSchema,
  type BackupFile,
  type BackupKind,
  type WorkspaceState,
} from "./schema";

/**
 * Persistence of a workspace as one validated JSON file.
 *
 *   data/<workspace>/state.json        current state (never written in place)
 *   data/<workspace>/state.tmp         write-ahead copy, atomically renamed over state.json
 *   data/<workspace>/backups/*.json    automatic snapshots (rolling) + manual backups (kept)
 *
 * Every mutation runs through a per-workspace queue: load → (snapshot) → apply on a copy →
 * validate → atomic write. If anything fails, the previous state.json is left untouched.
 */

export interface MutationContext {
  workspace: Workspace;
  now: Date;
}

export interface MutationOptions<T = unknown> {
  /**
   * Make the change undoable: snapshot the previous state automatically and record this label
   * (computed from the result if needed) as the workspace's "last change".
   */
  undoable?: string | ((result: T) => string);
  now?: Date;
}

export interface BackupInfo {
  id: string;
  kind: BackupKind;
  reason: string;
  createdAt: number;
  sizeBytes: number;
}

export interface StateRepository {
  load(workspace: Workspace): Promise<WorkspaceState>;
  /** Whether the workspace has been written at least once. */
  exists(workspace: Workspace): Promise<boolean>;
  save(workspace: Workspace, state: WorkspaceState): Promise<void>;
  mutate<T>(
    workspace: Workspace,
    fn: (draft: WorkspaceState, ctx: MutationContext) => T,
    options?: MutationOptions<T>,
  ): Promise<T>;
  backup(workspace: Workspace, reason: string, kind?: BackupKind): Promise<BackupInfo | null>;
  restore(workspace: Workspace, backupId: string, label?: string): Promise<void>;
  listBackups(workspace: Workspace): Promise<BackupInfo[]>;
  readBackup(workspace: Workspace, backupId: string): Promise<BackupFile>;
  /** Replace the whole state (import, reset), after an automatic snapshot. */
  replace(workspace: Workspace, next: WorkspaceState, reason: string): Promise<void>;
  paths(workspace: Workspace): { dir: string; state: string; backups: string };
}

export class StateLoadError extends Error {
  constructor(
    readonly workspace: Workspace,
    readonly path: string,
    readonly problems: string[],
  ) {
    super(`Cannot load the ${workspace} workspace (${path}): ${problems[0] ?? "invalid file"}`);
    this.name = "StateLoadError";
  }
}

const BACKUP_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}(-\d+)?(-manual|-export)?$/;

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

interface CacheEntry {
  state: WorkspaceState;
  mtimeMs: number;
  size: number;
}

export class FileStateRepository implements StateRepository {
  private readonly root: string;
  private readonly queues = new Map<Workspace, Promise<unknown>>();
  private readonly cache = new Map<Workspace, CacheEntry>();

  constructor(dataDir: string) {
    this.root = resolve(dataDir);
  }

  paths(workspace: Workspace) {
    const dir = join(this.root, workspace.toLowerCase());
    return { dir, state: join(dir, "state.json"), backups: join(dir, "backups") };
  }

  async exists(workspace: Workspace): Promise<boolean> {
    try {
      await fs.access(this.paths(workspace).state);
      return true;
    } catch {
      return false;
    }
  }

  async load(workspace: Workspace): Promise<WorkspaceState> {
    const { state: file } = this.paths(workspace);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Never written yet: a fresh, empty workspace (nothing is created on disk by reading).
        return deepFreeze(createEmptyState(workspace));
      }
      throw error;
    }
    const cached = this.cache.get(workspace);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.state;

    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      throw new StateLoadError(workspace, file, ["The file is not valid JSON"]);
    }
    let state: WorkspaceState;
    try {
      state = assertStateIntegrity(raw, workspace);
    } catch (error) {
      if (error instanceof StateIntegrityError)
        throw new StateLoadError(workspace, file, error.problems);
      throw error;
    }
    deepFreeze(state);
    this.cache.set(workspace, { state, mtimeMs: stat.mtimeMs, size: stat.size });
    return state;
  }

  /** Validate, then write atomically: state.tmp → fsync → rename over state.json. */
  async save(workspace: Workspace, state: WorkspaceState): Promise<void> {
    const valid = assertStateIntegrity(state, workspace);
    const { dir, state: file } = this.paths(workspace);
    await fs.mkdir(dir, { recursive: true });
    const tmp = join(dir, "state.tmp");
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(`${JSON.stringify(valid, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
    const stat = await fs.stat(file);
    this.cache.set(workspace, { state: deepFreeze(valid), mtimeMs: stat.mtimeMs, size: stat.size });
  }

  /** Serialise operations per workspace (single-user app: an in-process queue is enough). */
  private enqueue<T>(workspace: Workspace, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspace) ?? Promise.resolve();
    const run = previous.then(task, task);
    this.queues.set(
      workspace,
      run.catch(() => undefined),
    );
    return run;
  }

  mutate<T>(
    workspace: Workspace,
    fn: (draft: WorkspaceState, ctx: MutationContext) => T,
    options: MutationOptions<T> = {},
  ): Promise<T> {
    return this.enqueue(workspace, async () => {
      const now = options.now ?? new Date();
      const current = await this.load(workspace);
      const draft = structuredClone(current) as WorkspaceState;
      // Any exception here leaves state.json untouched (the draft is simply dropped).
      const result = fn(draft, { workspace, now });
      draft.metadata.mutationCount += 1;
      draft.strategyVersion = draft.settings.strategyVersion;
      draft.savedAt = now.toISOString();
      if (options.undoable) {
        const label =
          typeof options.undoable === "function" ? options.undoable(result) : options.undoable;
        // Validate first so a rejected change never leaves a useless snapshot behind.
        assertStateIntegrity(draft, workspace);
        const snapshot = await this.writeBackup(
          workspace,
          current,
          `Before: ${label}`,
          "AUTO",
          now,
        );
        draft.metadata.lastChange = {
          label,
          backupId: snapshot.id,
          at: now.getTime(),
          mutationCount: draft.metadata.mutationCount,
        };
      }
      await this.save(workspace, draft);
      return result;
    });
  }

  replace(workspace: Workspace, next: WorkspaceState, reason: string): Promise<void> {
    return this.enqueue(workspace, async () => {
      const now = new Date();
      const snapshot = (await this.exists(workspace))
        ? await this.writeBackup(
            workspace,
            await this.load(workspace),
            `Before: ${reason}`,
            "AUTO",
            now,
          )
        : null;
      const draft = structuredClone(next) as WorkspaceState;
      draft.metadata.mutationCount += 1;
      draft.metadata.lastChange = snapshot
        ? {
            label: reason,
            backupId: snapshot.id,
            at: now.getTime(),
            mutationCount: draft.metadata.mutationCount,
          }
        : null;
      draft.savedAt = now.toISOString();
      await this.save(workspace, draft);
    });
  }

  backup(
    workspace: Workspace,
    reason: string,
    kind: BackupKind = "MANUAL",
  ): Promise<BackupInfo | null> {
    return this.enqueue(workspace, async () => {
      if (!(await this.exists(workspace))) return null;
      return this.writeBackup(workspace, await this.load(workspace), reason, kind, new Date());
    });
  }

  restore(workspace: Workspace, backupId: string, label?: string): Promise<void> {
    return this.enqueue(workspace, async () => {
      const backup = await this.readBackup(workspace, backupId);
      if (backup.workspace !== workspace || backup.state.workspace !== workspace) {
        throw new StateLoadError(workspace, backupId, [
          "This snapshot belongs to another workspace",
        ]);
      }
      const now = new Date();
      // Restoring is itself undoable: snapshot the current state first. A current file that
      // fails validation is kept aside (never deleted) so a snapshot can still be restored.
      let current: WorkspaceState | null = null;
      if (await this.exists(workspace)) {
        try {
          current = await this.load(workspace);
        } catch (error) {
          if (!(error instanceof StateLoadError)) throw error;
          const { dir, state: file } = this.paths(workspace);
          await fs.rename(file, join(dir, `state.rejected-${stamp(now)}.json`));
          this.cache.delete(workspace);
        }
      }
      const before = current
        ? await this.writeBackup(workspace, current, `Before restoring ${backupId}`, "AUTO", now)
        : null;
      const draft = structuredClone(backup.state) as WorkspaceState;
      draft.metadata.mutationCount = (current?.metadata.mutationCount ?? 0) + 1;
      draft.metadata.lastChange = before
        ? {
            label: label ?? `Restored snapshot ${backupId}`,
            backupId: before.id,
            at: now.getTime(),
            mutationCount: draft.metadata.mutationCount,
          }
        : null;
      draft.savedAt = now.toISOString();
      await this.save(workspace, draft);
    });
  }

  async readBackup(workspace: Workspace, backupId: string): Promise<BackupFile> {
    if (!BACKUP_ID_RE.test(backupId))
      throw new StateLoadError(workspace, backupId, ["Unknown snapshot"]);
    const file = join(this.paths(workspace).backups, `${backupId}.json`);
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      throw new StateLoadError(workspace, file, ["Snapshot not found or not valid JSON"]);
    }
    const parsed = backupFileSchema.safeParse(raw);
    if (!parsed.success)
      throw new StateLoadError(workspace, file, ["Snapshot does not match the backup format"]);
    return parsed.data;
  }

  async listBackups(workspace: Workspace): Promise<BackupInfo[]> {
    const dir = this.paths(workspace).backups;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const infos = await Promise.all(
      names
        .filter((n) => n.endsWith(".json") && BACKUP_ID_RE.test(n.slice(0, -5)))
        .map(async (name) => {
          const file = join(dir, name);
          const handle = await fs.open(file, "r");
          try {
            const { size } = await handle.stat();
            // Header fields are written first: a small prefix is enough to list backups.
            const buffer = Buffer.alloc(Math.min(size, 2048));
            await handle.read(buffer, 0, buffer.length, 0);
            const head = buffer.toString("utf8");
            const kind = /"kind":\s*"(AUTO|MANUAL|EXPORT)"/.exec(head)?.[1] as
              BackupKind | undefined;
            const createdAt = Number(/"createdAt":\s*(\d+)/.exec(head)?.[1] ?? 0);
            const reason = /"reason":\s*("(?:[^"\\]|\\.)*")/.exec(head)?.[1];
            return {
              id: name.slice(0, -5),
              kind: kind ?? "AUTO",
              reason: reason ? (JSON.parse(reason) as string) : "",
              createdAt,
              sizeBytes: size,
            } satisfies BackupInfo;
          } finally {
            await handle.close();
          }
        }),
    );
    return infos.sort((a, b) => b.id.localeCompare(a.id));
  }

  private async writeBackup(
    workspace: Workspace,
    state: WorkspaceState,
    reason: string,
    kind: BackupKind,
    now: Date,
  ): Promise<BackupInfo> {
    const dir = this.paths(workspace).backups;
    await fs.mkdir(dir, { recursive: true });
    const suffix = kind === "MANUAL" ? "-manual" : kind === "EXPORT" ? "-export" : "";
    let id = `${stamp(now)}${suffix}`;
    for (let n = 1; await fileExists(join(dir, `${id}.json`)); n += 1)
      id = `${stamp(now)}-${n}${suffix}`;
    const file: BackupFile = {
      format: BACKUP_FORMAT,
      kind,
      workspace,
      createdAt: now.getTime(),
      reason,
      state,
    };
    const json = `${JSON.stringify(file, null, 2)}\n`;
    const tmp = join(dir, `${id}.tmp`);
    await fs.writeFile(tmp, json, "utf8");
    await fs.rename(tmp, join(dir, `${id}.json`));
    if (kind === "AUTO") await this.pruneAutomatic(workspace, state.settings.backups.keepAutomatic);
    return { id, kind, reason, createdAt: now.getTime(), sizeBytes: Buffer.byteLength(json) };
  }

  /** Keep the newest N automatic snapshots. Manual backups and exports are never deleted. */
  private async pruneAutomatic(workspace: Workspace, keep: number): Promise<void> {
    const dir = this.paths(workspace).backups;
    const automatic = (await fs.readdir(dir))
      .filter((n) => n.endsWith(".json") && BACKUP_ID_RE.test(n.slice(0, -5)))
      .filter((n) => !n.includes("-manual") && !n.includes("-export"))
      .sort();
    const excess = automatic.length - keep;
    for (const name of automatic.slice(0, Math.max(0, excess)))
      await fs.rm(join(dir, name), { force: true });
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
