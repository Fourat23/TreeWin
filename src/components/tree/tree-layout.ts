import { stratify, tree } from "d3-hierarchy";
import { compareBranchCodes } from "@/domain/branches/codes";

export type Orientation = "TB" | "LR";

export interface LayoutItem {
  id: string;
  parentId: string | null;
  code: string;
  scale: number;
}

export interface LayoutOptions {
  orientation: Orientation;
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
}

const VIRTUAL_ROOT = "__celltree_root__";

/**
 * Tidy tree layout (Reingold–Tilford via d3-hierarchy). Several roots hang under a virtual
 * root that is not rendered. Returns the top-left position of each node.
 */
export function layoutTree(
  items: readonly LayoutItem[],
  options: LayoutOptions,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (items.length === 0) return positions;
  const ids = new Set(items.map((i) => i.id));
  const rows = [
    { id: VIRTUAL_ROOT, parentId: null as string | null, code: "", scale: 1 },
    // A node whose parent is hidden becomes a top-level node.
    ...items.map((i) => ({
      ...i,
      parentId: i.parentId && ids.has(i.parentId) ? i.parentId : VIRTUAL_ROOT,
    })),
  ];
  const root = stratify<(typeof rows)[number]>()
    .id((d) => d.id)
    .parentId((d) => d.parentId)(rows);
  root.sort((a, b) => compareBranchCodes(a.data.code, b.data.code));

  const horizontal = options.orientation === "LR";
  const breadth =
    (horizontal ? options.nodeHeight : options.nodeWidth) +
    (horizontal ? options.gapY : options.gapX);
  const depth =
    (horizontal ? options.nodeWidth : options.nodeHeight) +
    (horizontal ? options.gapX : options.gapY);
  const maxScale = Math.max(1, ...items.map((i) => i.scale));

  tree<(typeof rows)[number]>()
    .nodeSize([breadth, depth * maxScale])
    .separation((a, b) => ((a.data.scale + b.data.scale) / 2) * (a.parent === b.parent ? 1 : 1.2))(
    root,
  );

  for (const node of root.descendants()) {
    if (node.data.id === VIRTUAL_ROOT) continue;
    const along = node.x ?? 0;
    const across = ((node.depth ?? 1) - 1) * depth * maxScale;
    const w = options.nodeWidth * node.data.scale;
    const h = options.nodeHeight * node.data.scale;
    positions.set(
      node.data.id,
      horizontal ? { x: across, y: along - h / 2 } : { x: along - w / 2, y: across },
    );
  }
  return positions;
}
