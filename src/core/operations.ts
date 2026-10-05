import type { DeviceViewport } from "./viewport";
import {
  CoreError,
  parseProject,
  stableStringify,
  type Project,
  type ProjectGroup,
  type ProjectPage,
  type ProjectNode,
  type JSONRecord,
  type Tokens,
} from "./project";
export type Operation =
  | { type: "updateProps"; nodeId: string; props: JSONRecord }
  | {
      type: "insertNode";
      pageId: string;
      parentId?: string;
      slot?: string;
      index: number;
      node: ProjectNode;
    }
  | {
      type: "moveNode";
      nodeId: string;
      pageId: string;
      parentId?: string;
      slot?: string;
      index: number;
    }
  | { type: "removeNode"; nodeId: string }
  | {
      type: "setViewport";
      pageId: string;
      width: number;
      height?: number;
      device?: DeviceViewport | null;
    }
  | { type: "addPage"; page: ProjectPage }
  | { type: "removePage"; pageId: string }
  | { type: "renamePage"; pageId: string; name: string }
  | { type: "setGroups"; groups: ProjectGroup[] }
  | { type: "setTheme"; theme: string }
  | { type: "setTokens"; tokens: Tokens };
export type Batch = {
  requestId: string;
  baseRevision: number;
  description?: string;
  author?: string;
  operations: Operation[];
};
export function applyBatch(project: Project, batch: Batch): Project {
  if (
    !batch ||
    typeof batch.requestId !== "string" ||
    !batch.requestId ||
    !Array.isArray(batch.operations) ||
    batch.operations.length > 1000
  )
    throw new CoreError("INVALID_BATCH");
  stableStringify(batch);
  if (
    Object.keys(batch).some(
      (key) =>
        ![
          "requestId",
          "baseRevision",
          "description",
          "author",
          "operations",
        ].includes(key),
    )
  )
    throw new CoreError("UNKNOWN_FIELD");
  if (
    (batch.description !== undefined &&
      (typeof batch.description !== "string" ||
        batch.description.length > 2000)) ||
    (batch.author !== undefined &&
      (typeof batch.author !== "string" || batch.author.length > 1000))
  )
    throw new CoreError("INVALID_BATCH");
  const operationFields: Record<Operation["type"], string[]> = {
    updateProps: ["nodeId", "props"],
    insertNode: ["pageId", "parentId", "slot", "index", "node"],
    moveNode: ["nodeId", "pageId", "parentId", "slot", "index"],
    removeNode: ["nodeId"],
    setViewport: ["pageId", "width", "height", "device"],
    addPage: ["page"],
    removePage: ["pageId"],
    renamePage: ["pageId", "name"],
    setGroups: ["groups"],
    setTheme: ["theme"],
    setTokens: ["tokens"],
  };
  for (const operation of batch.operations) {
    if (
      !operation ||
      typeof operation !== "object" ||
      !Object.hasOwn(operationFields, operation.type)
    )
      throw new CoreError("UNKNOWN_OPERATION");
    if (
      Object.keys(operation).some(
        (key) =>
          key !== "type" && !operationFields[operation.type].includes(key),
      )
    )
      throw new CoreError("UNKNOWN_FIELD");
  }
  if (batch.baseRevision !== project.revision)
    throw new CoreError("REVISION_CONFLICT");
  const next = structuredClone(project);
  const page = (id: string) => {
    const result = next.pages.find((p) => p.screenId === id);
    if (!result) throw new CoreError("PAGE_NOT_FOUND", id);
    return result;
  };
  function locate(
    id: string,
  ): { node: ProjectNode; list: ProjectNode[]; index: number } | undefined {
    function walk(list: ProjectNode[]): ReturnType<typeof locate> {
      for (let index = 0; index < list.length; index++) {
        const node = list[index];
        if (node.id === id) return { node, list, index };
        for (const children of Object.values(node.slots)) {
          const found = walk(children);
          if (found) return found;
        }
      }
    }
    for (const p of next.pages) {
      const found = walk(p.nodes);
      if (found) return found;
    }
  }
  function required(id: string) {
    const n = locate(id);
    if (!n) throw new CoreError("NODE_NOT_FOUND", id);
    return n;
  }
  function destination(op: {
    pageId: string;
    parentId?: string;
    slot?: string;
    index: number;
  }): ProjectNode[] {
    const target = page(op.pageId);
    let list = target.nodes;
    if (op.parentId) {
      function find(nodes: ProjectNode[]): ProjectNode | undefined {
        for (const n of nodes) {
          if (n.id === op.parentId) return n;
          for (const children of Object.values(n.slots)) {
            const result = find(children);
            if (result) return result;
          }
        }
      }
      const parent = find(target.nodes);
      if (!parent) throw new CoreError("PARENT_NOT_FOUND");
      if (!op.slot || !Object.hasOwn(parent.slots, op.slot))
        throw new CoreError("INVALID_SLOT");
      list = parent.slots[op.slot];
    } else if (op.slot) throw new CoreError("INVALID_SLOT");
    if (!Number.isInteger(op.index) || op.index < 0 || op.index > list.length)
      throw new CoreError("INVALID_INDEX");
    return list;
  }
  for (const op of batch.operations) {
    switch (op.type) {
      case "updateProps": {
        const n = required(op.nodeId).node;
        n.props = { ...n.props, ...op.props };
        break;
      }
      case "insertNode":
        destination(op).splice(op.index, 0, structuredClone(op.node));
        break;
      case "moveNode": {
        const old = required(op.nodeId);
        if (op.parentId) {
          const descendant = (n: ProjectNode): boolean =>
            n.id === op.parentId ||
            Object.values(n.slots).some((nodes) => nodes.some(descendant));
          if (descendant(old.node)) throw new CoreError("NODE_CYCLE");
        }
        old.list.splice(old.index, 1);
        destination(op).splice(op.index, 0, old.node);
        break;
      }
      case "removeNode": {
        const n = required(op.nodeId);
        n.list.splice(n.index, 1);
        break;
      }
      case "setViewport": {
        const viewport = page(op.pageId).viewport;
        const resized =
          viewport.width !== op.width ||
          (op.height !== undefined && viewport.height !== op.height);
        viewport.width = op.width;
        if (op.height !== undefined) viewport.height = op.height;
        if (op.device === null) delete viewport.device;
        else if (op.device !== undefined)
          viewport.device = structuredClone(op.device);
        else if (resized && viewport.device) viewport.device.preset = "custom";
        break;
      }
      case "addPage":
        next.pages.push(structuredClone(op.page));
        break;
      case "removePage":
        page(op.pageId);
        next.pages = next.pages.filter((p) => p.screenId !== op.pageId);
        for (const group of next.groups ?? [])
          group.pages = group.pages.filter((id) => id !== op.pageId);
        break;
      case "renamePage":
        page(op.pageId).name = op.name;
        break;
      case "setGroups":
        next.groups = structuredClone(op.groups);
        break;
      case "setTheme":
        next.theme = op.theme;
        break;
      case "setTokens":
        next.tokens = structuredClone(op.tokens);
        for (const group of next.groups ?? [])
          group.tokens = group.tokens.filter((name) =>
            Object.hasOwn(next.tokens, name),
          );
        break;
      default:
        throw new CoreError("UNKNOWN_OPERATION");
    }
  }
  next.revision++;
  return parseProject(next);
}
