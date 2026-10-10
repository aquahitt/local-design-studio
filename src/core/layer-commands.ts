import {
  CoreError,
  type JSONValue,
  type JSONRecord,
  type Tokens,
} from "./tokens";
import { stableStringify, type Project, type ProjectNode } from "./project";
import type { Operation } from "./operations";
import {
  definitionNodes,
  type DesignComponentDefinition,
  type ComponentOverrides,
} from "./design-components";
import { sceneLayers } from "./scene";

export type LayerCommand =
  | { type: "rename"; name: string }
  | { type: "hidden" | "locked"; value: boolean }
  | { type: "delete" };
export type LayerClipboard = {
  schemaVersion: 1;
  sourceProjectId: string;
  nodes: ProjectNode[];
  designComponents: DesignComponentDefinition[];
  tokens: Tokens;
  assets: string[];
};
export type LayerDestination = {
  pageId: string;
  parentId?: string;
  slot?: string;
  index: number;
};
export type PasteResult = {
  operations: Operation[];
  diagnostics: { code: "MISSING_ASSET"; asset: string }[];
  idMap: Record<string, string>;
};
function selectedRoots(project: Project, nodeIds: string[]): ProjectNode[] {
  const selected = new Set(nodeIds),
    found = new Set<string>();
  const result: ProjectNode[] = [];
  function walk(nodes: ProjectNode[], selectedAncestor = false) {
    for (const node of nodes) {
      const isSelected = selected.has(node.id);
      if (isSelected) found.add(node.id);
      if (isSelected && !selectedAncestor) result.push(node);
      for (const children of Object.values(node.slots))
        walk(children, selectedAncestor || isSelected);
    }
  }
  project.pages.forEach((page) => walk(page.nodes));
  for (const id of selected)
    if (!found.has(id)) throw new CoreError("NODE_NOT_FOUND", id);
  return result;
}
export function layerCommandOperations(
  project: Project,
  nodeIds: string[],
  command: LayerCommand,
): Operation[] {
  const all = new Map(
    project.pages.flatMap((page) => [...definitionNodes(page.nodes)]),
  );
  for (const id of nodeIds)
    if (!all.has(id)) throw new CoreError("NODE_NOT_FOUND", id);
  if (command.type === "delete")
    return selectedRoots(project, nodeIds).map((node) => ({
      type: "removeNode",
      nodeId: node.id,
    }));
  return [...new Set(nodeIds)].map((nodeId) =>
    command.type === "rename"
      ? { type: "setNodeMetadata", nodeId, name: command.name }
      : command.type === "hidden"
        ? { type: "setNodeMetadata", nodeId, hidden: command.value }
        : { type: "setNodeMetadata", nodeId, locked: command.value },
  );
}
/** Append selected roots in document order; indices follow each intermediate move. */
export function moveLayersToEnd(
  project: Project,
  nodeIds: string[],
  destination: Omit<LayerDestination, "index">,
): Operation[] {
  const page = project.pages.find((page) => page.screenId === destination.pageId);
  if (!page) throw new CoreError("PAGE_NOT_FOUND");
  let list = page.nodes;
  if (destination.parentId) {
    const parent = definitionNodes(page.nodes).get(destination.parentId);
    if (!parent) throw new CoreError("PARENT_NOT_FOUND");
    if (!destination.slot || !Object.hasOwn(parent.slots, destination.slot))
      throw new CoreError("INVALID_SLOT");
    list = parent.slots[destination.slot];
  } else if (destination.slot) throw new CoreError("INVALID_SLOT");
  const ids = list.map((node) => node.id);
  return selectedRoots(project, nodeIds).map((node) => {
    const existing = ids.indexOf(node.id);
    if (existing !== -1) ids.splice(existing, 1);
    const index = ids.length;
    ids.push(node.id);
    return { type: "moveNode", nodeId: node.id, ...destination, index };
  });
}
function visitJSON(value: unknown, visit: (value: unknown) => void) {
  visit(value);
  if (value && typeof value === "object")
    Object.values(value).forEach((child) => visitJSON(child, visit));
}
export function copyLayers(
  project: Project,
  nodeIds: string[],
): LayerClipboard {
  const nodes = structuredClone(selectedRoots(project, nodeIds));
  const definitionIds = new Set<string>();
  function references(nodes: ProjectNode[]) {
    definitionNodes(nodes).forEach((node) => {
      const id = node.instance?.definitionId;
      if (!id || definitionIds.has(id)) return;
      definitionIds.add(id);
      const definition = project.designComponents?.find(
        (definition) => definition.id === id,
      );
      if (!definition) throw new CoreError("MISSING_COMPONENT", id);
      references(definition.nodes);
    });
  }
  references(nodes);
  const definitions = structuredClone(
    (project.designComponents ?? []).filter((definition) =>
      definitionIds.has(definition.id),
    ),
  );
  const tokens: Tokens = {};
  function dependencies(value: unknown) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "$token" in value
    ) {
      const key = String(value.$token);
      if (Object.hasOwn(tokens, key)) return;
      const token = project.tokens[key];
      if (!token) throw new CoreError("MISSING_TOKEN", key);
      tokens[key] = structuredClone(token);
      visitJSON(token, dependencies);
    }
  }
  visitJSON([nodes, definitions], dependencies);
  const assets = new Set<string>();
  visitJSON([nodes, definitions, tokens], (value) => {
    if (typeof value === "string" && value.startsWith("assets/"))
      assets.add(value);
  });
  return {
    schemaVersion: 1,
    sourceProjectId: project.projectId,
    nodes,
    designComponents: definitions,
    tokens,
    assets: [...assets].sort(),
  };
}
export function pasteLayers(
  project: Project,
  clipboard: LayerClipboard,
  destination: LayerDestination,
  makeId: () => string = () => crypto.randomUUID(),
  availableAssets?: ReadonlySet<string>,
): PasteResult {
  if (
    clipboard.schemaVersion !== 1 ||
    !Array.isArray(clipboard.nodes) ||
    !Array.isArray(clipboard.designComponents)
  )
    throw new CoreError("INVALID_CLIPBOARD");
  // Canonical serialization rejects cycles/executable JS before traversing imported data.
  stableStringify(clipboard);
  const copied = structuredClone(clipboard);
  const idMap: Record<string, string> = Object.create(null);
  const definitionMap = new Map<string, string>();
  const usedIds = new Set<string>();
  project.pages.forEach((page) =>
    definitionNodes(page.nodes).forEach((_, id) => usedIds.add(id)),
  );
  (project.designComponents ?? []).forEach((definition) => {
    usedIds.add(definition.id);
    definitionNodes(definition.nodes).forEach((_, id) => usedIds.add(id));
  });
  function fresh() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = makeId();
      if (typeof id !== "string" || !id || id.length > 1000)
        throw new CoreError("INVALID_ID_GENERATOR");
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
    throw new CoreError("INVALID_ID_GENERATOR");
  }
  definitionNodes(copied.nodes).forEach((_, id) => {
    idMap[id] = fresh();
  });
  const imported: DesignComponentDefinition[] = [];
  for (const definition of copied.designComponents) {
    const existing = project.designComponents?.find(
      (item) => item.id === definition.id,
    );
    if (
      copied.sourceProjectId === project.projectId &&
      existing &&
      stableStringify(existing) === stableStringify(definition)
    ) {
      definitionMap.set(definition.id, existing.id);
    } else {
      const id = fresh();
      definitionMap.set(definition.id, id);
      definition.id = id;
      definitionNodes(definition.nodes).forEach((_, nodeId) => {
        idMap[nodeId] = fresh();
      });
      imported.push(definition);
    }
  }
  const tokenMap = new Map<string, string>();
  const tokens = structuredClone(project.tokens);
  const usedTokenNames = new Set([
    ...Object.keys(tokens),
    ...Object.keys(copied.tokens),
  ]);
  const activeTokens = new Set<string>();
  function tokenRefs(value: JSONValue): JSONValue {
    if (Array.isArray(value)) return value.map(tokenRefs);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          key === "$token" && typeof child === "string"
            ? (tokenMap.get(child) ?? child)
            : tokenRefs(child),
        ]),
      );
    return value;
  }
  function chooseToken(key: string) {
    if (tokenMap.has(key)) return;
    if (activeTokens.has(key)) throw new CoreError("TOKEN_CYCLE", key);
    const token = copied.tokens[key];
    if (!token) return;
    activeTokens.add(key);
    visitJSON(token, (value) => {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "$token" in value
      )
        chooseToken(String(value.$token));
    });
    const remapped = tokenRefs(
      token as unknown as JSONValue,
    ) as unknown as typeof token;
    let next = key;
    if (
      Object.hasOwn(tokens, key) &&
      stableStringify(tokens[key]) !== stableStringify(remapped)
    ) {
      let index = 0;
      do {
        next = `${key}-copy-${++index}`;
      } while (usedTokenNames.has(next));
    }
    usedTokenNames.add(next);
    tokenMap.set(key, next);
    tokens[next] = remapped;
    activeTokens.delete(key);
  }
  Object.keys(copied.tokens).forEach(chooseToken);
  function remapPatches(
    patches: ComponentOverrides | undefined,
  ): ComponentOverrides | undefined {
    if (!patches) return patches;
    return Object.fromEntries(
      Object.entries(patches).map(([key, props]) => [
        idMap[key] ?? key,
        tokenRefs(props) as JSONRecord,
      ]),
    );
  }
  function remap(nodes: ProjectNode[]) {
    for (const node of nodes) {
      node.id = idMap[node.id] ?? node.id;
      node.props = tokenRefs(node.props) as typeof node.props;
      if (node.instance) {
        node.instance.definitionId =
          definitionMap.get(node.instance.definitionId) ??
          node.instance.definitionId;
        if (node.instance.overrides)
          node.instance.overrides = remapPatches(node.instance.overrides);
      }
      Object.values(node.slots).forEach(remap);
    }
  }
  remap(copied.nodes);
  for (const definition of imported) {
    remap(definition.nodes);
    if (definition.variants)
      definition.variants = Object.fromEntries(
        Object.entries(definition.variants).map(([name, patches]) => [
          name,
          remapPatches(patches)!,
        ]),
      );
    for (const binding of Object.values(definition.properties ?? {})) {
      binding.nodeId = idMap[binding.nodeId] ?? binding.nodeId;
      binding.default = tokenRefs(binding.default);
    }
  }
  const operations: Operation[] = [];
  if (stableStringify(tokens) !== stableStringify(project.tokens))
    operations.push({ type: "setTokens", tokens });
  if (imported.length)
    operations.push({
      type: "setDesignComponents",
      definitions: [...(project.designComponents ?? []), ...imported],
    });
  copied.nodes.forEach((node, offset) =>
    operations.push({
      type: "insertNode",
      ...destination,
      index: destination.index + offset,
      node,
    }),
  );
  return {
    operations,
    idMap,
    diagnostics: copied.assets
      .filter((asset) =>
        availableAssets
          ? !availableAssets.has(asset)
          : copied.sourceProjectId !== project.projectId,
      )
      .map((asset) => ({ code: "MISSING_ASSET", asset })),
  };
}
export function duplicateLayers(
  project: Project,
  nodeIds: string[],
  makeId?: () => string,
): PasteResult {
  const roots = selectedRoots(project, nodeIds);
  const layers = project.pages.flatMap((page) => sceneLayers(page.nodes));
  for (const root of roots) {
    const subtree = definitionNodes([root]);
    if (layers.some((layer) => subtree.has(layer.node.id) && layer.locked))
      throw new CoreError("NODE_LOCKED", root.id);
  }
  const operations: Operation[] = [],
    idMap: Record<string, string> = {},
    diagnostics: PasteResult["diagnostics"] = [];
  // Work against a preview so repeated sibling insertions preserve source order and unique IDs.
  const preview = structuredClone(project);
  for (const root of roots) {
    function find(
      nodes: ProjectNode[],
      pageId: string,
      parentId?: string,
      slot?: string,
    ): LayerDestination | undefined {
      for (let index = 0; index < nodes.length; index++) {
        if (nodes[index].id === root.id)
          return {
            pageId,
            ...(parentId ? { parentId, slot } : {}),
            index: index + 1,
          };
        for (const [name, children] of Object.entries(nodes[index].slots)) {
          const found = find(children, pageId, nodes[index].id, name);
          if (found) return found;
        }
      }
    }
    let destination: LayerDestination | undefined;
    for (const page of preview.pages) {
      destination = find(page.nodes, page.screenId);
      if (destination) break;
    }
    const result = pasteLayers(
      preview,
      copyLayers(project, [root.id]),
      destination!,
      makeId,
    );
    operations.push(...result.operations);
    Object.assign(idMap, result.idMap);
    // Track inserted IDs without executing unrelated commands or changing persisted state.
    for (const operation of result.operations)
      if (operation.type === "insertNode") {
        const page = preview.pages.find(
          (page) => page.screenId === operation.pageId,
        )!;
        const list = operation.parentId
          ? definitionNodes(page.nodes).get(operation.parentId)!.slots[
              operation.slot!
            ]
          : page.nodes;
        list.splice(operation.index, 0, structuredClone(operation.node));
      }
  }
  return { operations, diagnostics, idMap };
}
