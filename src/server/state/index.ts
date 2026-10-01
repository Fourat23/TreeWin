import "server-only";
import { FileStateRepository, type StateRepository } from "./repository";

const globalForStore = globalThis as unknown as { __celltreeRepository?: StateRepository };

/** Root folder of the workspaces (data/real, data/demo). Override with CELLTREE_DATA_DIR. */
export function resolveDataDir(): string {
  return process.env.CELLTREE_DATA_DIR ?? "./data";
}

/**
 * The single file-backed repository of this server process. Kept on globalThis so hot reloads
 * keep one mutation queue per workspace.
 */
export function getRepository(): StateRepository {
  globalForStore.__celltreeRepository ??= new FileStateRepository(resolveDataDir());
  return globalForStore.__celltreeRepository;
}
