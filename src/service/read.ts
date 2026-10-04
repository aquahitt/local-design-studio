import type { Project, ProjectNode } from "../core/project";
export interface ReadOptions {
  pageId?: string;
  nodeId?: string;
  offset?: number;
  limit?: number;
}
interface FlatNode extends Omit<ProjectNode, "slots"> {
  slots: Record<string, string[]>;
  pageId: string;
  parentId: string | null;
  slot: string | null;
  index: number;
}
/** Stable preorder paging. Partial page trees and flat relationship rows share the same selected IDs. */
export function readProjectPage(project: Project, options: ReadOptions = {}) {
  const offset = Math.max(0, Math.floor(options.offset ?? 0)),
    limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
  const pages = project.pages.filter(
      (page) => !options.pageId || page.screenId === options.pageId,
    ),
    flat: FlatNode[] = [];
  const walk = (
    nodes: ProjectNode[],
    pageId: string,
    parentId: string | null = null,
    slot: string | null = null,
  ) => {
    nodes.forEach((node, index) => {
      if (!options.nodeId || node.id === options.nodeId)
        flat.push({
          ...node,
          slots: Object.fromEntries(
            Object.keys(node.slots)
              .sort()
              .map((name) => [name, node.slots[name].map((child) => child.id)]),
          ),
          pageId,
          parentId,
          slot,
          index,
        });
      for (const name of Object.keys(node.slots).sort())
        walk(node.slots[name], pageId, node.id, name);
    });
  };
  for (const page of pages) walk(page.nodes, page.screenId);
  const rows = flat.slice(offset, offset + limit),
    selected = new Set(rows.map((row) => row.id));
  const partial = (nodes: ProjectNode[]): ProjectNode[] => {
    const result: ProjectNode[] = [];
    for (const node of nodes) {
      const slots = Object.fromEntries(
        Object.keys(node.slots)
          .sort()
          .map((name) => [name, partial(node.slots[name])]),
      );
      if (selected.has(node.id)) result.push({ ...node, slots });
      else
        for (const children of Object.values(slots)) result.push(...children);
    }
    return result;
  };
  return {
    ...project,
    pages: pages.map((page) => ({ ...page, nodes: partial(page.nodes) })),
    nodes: rows,
    pagination: {
      total: flat.length,
      offset,
      limit,
      nextOffset:
        offset + rows.length < flat.length ? offset + rows.length : null,
      truncated: rows.length < flat.length,
    },
  };
}
