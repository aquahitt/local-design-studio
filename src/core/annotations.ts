import { CoreError } from "./tokens";
import type { Project, ProjectNode, ProjectPage } from "./project";

export type ProjectAnnotation = {
  id: string;
  pageId?: string;
  nodeId?: string;
  x?: number;
  y?: number;
  text: string;
  status: "open" | "resolved";
  decision?: string;
  proposalId?: string;
  createdAt: string;
};
export type PageProvenance = { sourcePageId: string; sourceRevision: number };
export function parseAnnotations(input: unknown): ProjectAnnotation[] {
  if (!Array.isArray(input) || input.length > 10000)
    throw new CoreError("INVALID_ANNOTATIONS");
  const ids = new Set<string>();
  return input.map((raw, index) => {
    const path = `annotations[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new CoreError("INVALID_ANNOTATION", "", path);
    const row = raw as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (key) =>
          ![
            "id",
            "pageId",
            "nodeId",
            "x",
            "y",
            "text",
            "status",
            "decision",
            "proposalId",
            "createdAt",
          ].includes(key),
      )
    )
      throw new CoreError("UNKNOWN_FIELD", "", path);
    for (const key of [
      "id",
      "text",
      "createdAt",
      "pageId",
      "nodeId",
      "decision",
      "proposalId",
    ]) {
      const value = row[key];
      if (value === undefined && !["id", "text", "createdAt"].includes(key))
        continue;
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > (["text", "decision"].includes(key) ? 10000 : 1000)
      )
        throw new CoreError("INVALID_ANNOTATION", key, `${path}.${key}`);
    }
    if (
      typeof row.status !== "string" ||
      !["open", "resolved"].includes(row.status) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(row.createdAt as string) ||
      !Number.isFinite(Date.parse(row.createdAt as string))
    )
      throw new CoreError("INVALID_ANNOTATION", "", path);
    if (
      (row.x === undefined) !== (row.y === undefined) ||
      (row.x !== undefined && !row.pageId)
    )
      throw new CoreError(
        "INVALID_ANNOTATION",
        "coordinates require pageId, x and y",
        path,
      );
    for (const key of ["x", "y"])
      if (
        row[key] !== undefined &&
        (typeof row[key] !== "number" ||
          !Number.isFinite(row[key]) ||
          Math.abs(row[key] as number) > 1000000)
      )
        throw new CoreError("INVALID_ANNOTATION", key, `${path}.${key}`);
    if (ids.has(row.id as string))
      throw new CoreError(
        "DUPLICATE_ANNOTATION_ID",
        row.id as string,
        `${path}.id`,
      );
    ids.add(row.id as string);
    return Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== undefined),
    ) as ProjectAnnotation;
  });
}

export function parsePageProvenance(input: unknown): PageProvenance {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CoreError("INVALID_PAGE_PROVENANCE");
  const row = input as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => !["sourcePageId", "sourceRevision"].includes(key),
    )
  )
    throw new CoreError("UNKNOWN_FIELD");
  if (
    typeof row.sourcePageId !== "string" ||
    !row.sourcePageId ||
    row.sourcePageId.length > 1000 ||
    !Number.isInteger(row.sourceRevision) ||
    (row.sourceRevision as number) < 0
  )
    throw new CoreError("INVALID_PAGE_PROVENANCE");
  return {
    sourcePageId: row.sourcePageId,
    sourceRevision: row.sourceRevision as number,
  };
}

/** Page alternatives share definitions/assets/tokens, but own all page node IDs and props. */
export function createPageVariant(
  project: Project,
  pageId: string,
  newPageId: string,
  name: string,
): ProjectPage & { provenance: PageProvenance } {
  const source = project.pages.find((page) => page.screenId === pageId);
  if (!source) throw new CoreError("PAGE_NOT_FOUND");
  if (project.pages.some((page) => page.screenId === newPageId))
    throw new CoreError("PAGE_EXISTS");
  if (
    typeof newPageId !== "string" ||
    !newPageId ||
    newPageId.length > 1000 ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 1000
  )
    throw new CoreError("INVALID_PAGE_VARIANT");
  const used = new Set<string>();
  const visit = (nodes: ProjectNode[], mutate = false) => {
    for (const node of nodes) {
      if (mutate) {
        const id = `${newPageId}:${node.id}`;
        if (id.length > 1000 || used.has(id))
          throw new CoreError("NODE_EXISTS", id);
        used.add(id);
        node.id = id;
      } else used.add(node.id);
      Object.values(node.slots).forEach((children) => visit(children, mutate));
    }
  };
  project.pages.forEach((page) => visit(page.nodes));
  project.designComponents?.forEach((definition) => visit(definition.nodes));
  const copy = structuredClone(source);
  visit(copy.nodes, true);
  return {
    ...copy,
    screenId: newPageId,
    name: name.trim(),
    provenance: { sourcePageId: pageId, sourceRevision: project.revision },
  };
}

export function readAnnotations(
  project: Pick<Project, "pages" | "revision"> & {
    annotations?: ProjectAnnotation[];
  },
  options: {
    pageId?: string;
    nodeId?: string;
    status?: string;
    orphaned?: boolean;
    offset?: number;
    limit?: number;
  } = {},
) {
  const nodes = new Map<string, string>();
  const walk = (rows: ProjectNode[], pageId: string) =>
    rows.forEach((node) => {
      nodes.set(node.id, pageId);
      Object.values(node.slots).forEach((children) => walk(children, pageId));
    });
  project.pages.forEach((page) => walk(page.nodes, page.screenId));
  const pages = new Set(project.pages.map((page) => page.screenId));
  const rows = (project.annotations ?? [])
    .map((annotation) => ({
      ...annotation,
      orphaned:
        (!!annotation.pageId && !pages.has(annotation.pageId)) ||
        (!!annotation.nodeId &&
          (!nodes.has(annotation.nodeId) ||
            (!!annotation.pageId &&
              nodes.get(annotation.nodeId) !== annotation.pageId))),
    }))
    .filter(
      (annotation) =>
        (!options.pageId ||
          annotation.pageId === options.pageId ||
          (!annotation.pageId &&
            !!annotation.nodeId &&
            nodes.get(annotation.nodeId) === options.pageId)) &&
        (!options.nodeId || annotation.nodeId === options.nodeId) &&
        (!options.status || annotation.status === options.status) &&
        (options.orphaned === undefined ||
          annotation.orphaned === options.orphaned),
    );
  const offset = Math.max(0, Math.floor(options.offset ?? 0)),
    limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
  const selected = rows.slice(offset, offset + limit);
  return {
    revision: project.revision,
    annotations: selected,
    pagination: {
      total: rows.length,
      offset,
      limit,
      nextOffset:
        offset + selected.length < rows.length
          ? offset + selected.length
          : null,
      truncated: selected.length < rows.length,
    },
  };
}
