/** Generic tree helpers over flat `{ id, parentId }` lists. */

export interface TreeItem {
  id: string;
  parentId: string | null;
}

export interface TreeIndex<T extends TreeItem> {
  byId: Map<string, T>;
  children: Map<string | null, T[]>;
}

export function buildTreeIndex<T extends TreeItem>(items: readonly T[]): TreeIndex<T> {
  const byId = new Map<string, T>();
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    byId.set(item.id, item);
    const siblings = children.get(item.parentId);
    if (siblings) siblings.push(item);
    else children.set(item.parentId, [item]);
  }
  return { byId, children };
}

/** Ancestors from the root down to (but excluding) `id`. */
export function ancestorsOf<T extends TreeItem>(index: TreeIndex<T>, id: string): T[] {
  const chain: T[] = [];
  const seen = new Set<string>([id]);
  let current = index.byId.get(id);
  while (current?.parentId) {
    if (seen.has(current.parentId)) break; // corrupted data guard
    seen.add(current.parentId);
    const parent = index.byId.get(current.parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** All descendants of `id`, breadth-first. */
export function descendantsOf<T extends TreeItem>(index: TreeIndex<T>, id: string): T[] {
  const result: T[] = [];
  const queue = [...(index.children.get(id) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    result.push(next);
    queue.push(...(index.children.get(next.id) ?? []));
  }
  return result;
}

/** Ids of the full lineage of `id`: ancestors, itself and descendants. */
export function lineageIds<T extends TreeItem>(index: TreeIndex<T>, id: string): Set<string> {
  const ids = new Set<string>([id]);
  for (const a of ancestorsOf(index, id)) ids.add(a.id);
  for (const d of descendantsOf(index, id)) ids.add(d.id);
  return ids;
}
