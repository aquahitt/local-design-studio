import {
  CoreError,
  resolveTokens,
  type JSONRecord,
  type JSONValue,
} from "./tokens";
import type { Project, ProjectNode } from "./project";
const instanceOrigins = new WeakMap<ProjectNode, string>();
/** Runtime origin mapping never changes or adds fields to persisted stable IDs. */
export function sceneSelectionId(node: ProjectNode): string {
  return instanceOrigins.get(node) ?? node.id;
}

export type ComponentOverrides = Record<string, JSONRecord>;
export type DesignInstance = {
  definitionId: string;
  variant?: string;
  overrides?: ComponentOverrides;
};
export type DesignComponentDefinition = {
  id: string;
  name: string;
  version: number;
  nodes: ProjectNode[];
  variants?: Record<string, ComponentOverrides>;
  properties?: Record<
    string,
    { nodeId: string; prop: string; default: JSONValue }
  >;
};

export function definitionNodes(
  nodes: ProjectNode[],
): Map<string, ProjectNode> {
  const result = new Map<string, ProjectNode>();
  function walk(nodes: ProjectNode[]) {
    for (const node of nodes) {
      result.set(node.id, node);
      Object.values(node.slots).forEach(walk);
    }
  }
  walk(nodes);
  return result;
}

/** Validate stable source-node links before resolution; updates never drop stale overrides silently. */
export function validateDesignComponents(project: Project): void {
  if (
    !project.designComponents?.length &&
    !project.pages.some((page) =>
      [...definitionNodes(page.nodes).values()].some((node) => node.instance),
    )
  )
    return;
  const values = resolveTokens(project.tokens, project.theme);
  function scalar(value: JSONValue): JSONValue {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.$token === "string"
    )
      return values[value.$token];
    return value;
  }
  function compatible(previous: JSONValue, value: JSONValue): boolean {
    previous = scalar(previous);
    value = scalar(value);
    if (previous === null) return true;
    return Array.isArray(previous)
      ? Array.isArray(value)
      : typeof previous === typeof value;
  }
  const definitions = new Map(
    (project.designComponents ?? []).map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const visited = new Set<string>(),
    active = new Set<string>();
  function overrides(
    definition: DesignComponentDefinition,
    patches: ComponentOverrides | undefined,
  ) {
    const nodes = definitionNodes(definition.nodes);
    for (const [nodeId, props] of Object.entries(patches ?? {})) {
      const node = nodes.get(nodeId);
      if (!node)
        throw new CoreError(
          "INCOMPATIBLE_COMPONENT",
          `${definition.id}.${nodeId}`,
        );
      for (const [key, value] of Object.entries(props))
        if (
          !Object.hasOwn(node.props, key) ||
          !compatible(node.props[key], value)
        )
          throw new CoreError(
            "INCOMPATIBLE_COMPONENT",
            `${definition.id}.${nodeId}.${key}`,
          );
    }
  }
  function instance(node: ProjectNode) {
    const reference = node.instance;
    if (!reference) return;
    const definition = definitions.get(reference.definitionId);
    if (!definition)
      throw new CoreError("MISSING_COMPONENT", reference.definitionId);
    visit(definition.id);
    if (Object.values(node.slots).some((children) => children.length))
      throw new CoreError("INVALID_INSTANCE", node.id);
    if (
      reference.variant !== undefined &&
      !Object.hasOwn(definition.variants ?? {}, reference.variant)
    )
      throw new CoreError(
        "INCOMPATIBLE_COMPONENT",
        `${definition.id}.${reference.variant}`,
      );
    overrides(definition, reference.overrides);
    for (const [key, value] of Object.entries(node.props)) {
      const property = definition.properties?.[key];
      if (!property || !compatible(property.default, value))
        throw new CoreError(
          "INCOMPATIBLE_COMPONENT",
          `${definition.id}.${key}`,
        );
    }
  }
  function visit(id: string) {
    if (active.size > 64) throw new CoreError("MAX_DEPTH");
    if (active.has(id))
      throw new CoreError("COMPONENT_CYCLE", [...active, id].join(" -> "));
    if (visited.has(id)) return;
    const definition = definitions.get(id)!;
    active.add(id);
    for (const patches of Object.values(definition.variants ?? {}))
      overrides(definition, patches);
    const nodes = definitionNodes(definition.nodes);
    for (const [name, binding] of Object.entries(definition.properties ?? {})) {
      const node = nodes.get(binding.nodeId);
      if (
        !node ||
        !Object.hasOwn(node.props, binding.prop) ||
        !compatible(node.props[binding.prop], binding.default)
      )
        throw new CoreError("INCOMPATIBLE_COMPONENT", `${id}.${name}`);
    }
    nodes.forEach(instance);
    active.delete(id);
    visited.add(id);
  }
  definitions.forEach((definition) => visit(definition.id));
  for (const page of project.pages)
    definitionNodes(page.nodes).forEach(instance);
}

/** Materialize local definitions into declarative wrappers, with stable virtual IDs. */
export function resolveSceneNodes(
  project: Project,
  nodes: ProjectNode[],
): ProjectNode[] {
  validateDesignComponents(project);
  const definitions = new Map(
    (project.designComponents ?? []).map((definition) => [
      definition.id,
      definition,
    ]),
  );
  let count = 0;
  const used = new Set<string>();
  project.pages.forEach((page) => definitionNodes(page.nodes).forEach((_, id) => used.add(id)));
  project.designComponents?.forEach((definition) => definitionNodes(definition.nodes).forEach((_, id) => used.add(id)));
  function resolve(
    source: ProjectNode[],
    prefix = "",
    depth = 0,
    origin?: string,
  ): ProjectNode[] {
    if (depth > 64) throw new CoreError("MAX_DEPTH");
    return source.map((raw) => {
      if (++count > 10000) throw new CoreError("MAX_NODES");
      const node = structuredClone(raw);
      node.id = prefix ? `${prefix}::${raw.id}` : raw.id;
      if (prefix) {
        const base = node.id; let suffix = 0;
        while (used.has(node.id)) node.id = `${base}~${++suffix}`;
        used.add(node.id);
        if (origin) instanceOrigins.set(node, origin);
      }
      if (raw.instance) {
        const definition = definitions.get(raw.instance.definitionId)!;
        const children = structuredClone(definition.nodes);
        const targets = definitionNodes(children);
        for (const binding of Object.values(definition.properties ?? {}))
          targets.get(binding.nodeId)!.props[binding.prop] = structuredClone(
            binding.default,
          );
        const patches = raw.instance.variant
          ? definition.variants?.[raw.instance.variant]
          : undefined;
        for (const [id, props] of Object.entries(patches ?? {}))
          Object.assign(targets.get(id)!.props, structuredClone(props));
        for (const [name, binding] of Object.entries(
          definition.properties ?? {},
        ))
          if (Object.hasOwn(raw.props, name))
            targets.get(binding.nodeId)!.props[binding.prop] = structuredClone(
              raw.props[name],
            );
        for (const [id, props] of Object.entries(raw.instance.overrides ?? {}))
          Object.assign(targets.get(id)!.props, structuredClone(props));
        delete node.instance;
        node.type = "SceneFrame";
        if (node.scene) node.scene = { ...node.scene, kind: "frame" };
        node.props = {};
        node.slots = { content: resolve(children, node.id, depth + 1, origin ?? raw.id) };
      } else {
        node.slots = Object.fromEntries(
          Object.entries(raw.slots).map(([slot, children]) => [
            slot,
            resolve(children, prefix, depth + 1, origin),
          ]),
        );
      }
      return node;
    });
  }
  return resolve(nodes);
}

/** Keep the instance wrapper ID; all expanded descendants become independent real nodes. */
export function detachDesignInstance(
  project: Project,
  source: ProjectNode,
): ProjectNode {
  if (!source.instance) throw new CoreError("NOT_AN_INSTANCE", source.id);
  const resolved = resolveSceneNodes(project, [source])[0];
  const usedIds = new Set<string>();
  for (const page of project.pages)
    definitionNodes(page.nodes).forEach((_, id) => usedIds.add(id));
  for (const definition of project.designComponents ?? [])
    definitionNodes(definition.nodes).forEach((_, id) => usedIds.add(id));
  let index = 0;
  function assign(nodes: ProjectNode[]) {
    for (const node of nodes) {
      instanceOrigins.delete(node);
      let id: string;
      do {
        id = `${source.id.slice(0, 960)}-detached-${++index}`;
      } while (usedIds.has(id));
      usedIds.add(id);
      node.id = id;
      Object.values(node.slots).forEach(assign);
    }
  }
  Object.values(resolved.slots).forEach(assign);
  return resolved;
}
