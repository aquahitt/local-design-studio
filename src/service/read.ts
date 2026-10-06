import type { LibraryMetadata } from "../library/sdk";
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
export function readProjectPage(
  project: Project,
  options: ReadOptions = {},
  includeTokens = true,
) {
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
    ...(includeTokens ? project : projectWithoutTokens(project)),
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

function projectWithoutTokens(project: Project) {
  const {
    tokens: _tokens,
    designComponents: _definitions,
    annotations: _annotations,
    ...metadata
  } = project;
  return metadata;
}

export function readPages(project: Project) {
  return {
    ...projectWithoutTokens(project),
    pages: project.pages.map(({ nodes: _nodes, ...page }) => page),
  };
}

export function readComponents(
  libraries: LibraryMetadata[],
  options: Record<string, unknown> = {},
) {
  const offset =
    typeof options.offset === "number"
      ? Math.max(0, Math.floor(options.offset))
      : 0;
  const limit =
    typeof options.limit === "number"
      ? Math.min(500, Math.max(1, Math.floor(options.limit)))
      : 100;
  const query =
    typeof options.query === "string" ? options.query.toLowerCase() : "";
  const components = libraries
    .filter((library) => !options.libraryId || library.id === options.libraryId)
    .flatMap((library) =>
      Object.entries(library.components).map(([id, component]) => ({
        libraryId: library.id,
        id,
        name: component.name,
        category: component.category ?? null,
        fields: Object.keys(component.fields),
      })),
    )
    .filter(
      (component) =>
        (!options.category || component.category === options.category) &&
        (!query ||
          component.name.toLowerCase().includes(query) ||
          component.id.toLowerCase().includes(query)),
    );
  const rows = components.slice(offset, offset + limit);
  return {
    components: rows,
    pagination: {
      total: components.length,
      offset,
      limit,
      nextOffset:
        offset + rows.length < components.length ? offset + rows.length : null,
      truncated: rows.length < components.length,
    },
  };
}

export function readComponent(
  libraries: LibraryMetadata[],
  libraryId: string,
  id: string,
) {
  const library = libraries.find((library) => library.id === libraryId);
  const component =
    library && Object.hasOwn(library.components, id)
      ? library.components[id]
      : undefined;
  if (!component) throw new Error("COMPONENT_NOT_FOUND");
  return { ...component, libraryId, id };
}
