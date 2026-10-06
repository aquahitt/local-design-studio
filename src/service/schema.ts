import type { Project, ProjectNode } from "../core/project";
import type { LibraryMetadata } from "../library/sdk";
import { resolveTokens } from "../core/tokens";
const str = { type: "string", minLength: 1 };
const number = { type: "number" };
const integer = { type: "integer", minimum: 0 };
const json = {};
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const coordinate = { type: "number", minimum: -1_000_000, maximum: 1_000_000 };
const dimension = { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 };
const sceneFields = {
  kind: { enum: ["frame", "text", "vector", "component", "image"] },
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
  rotation: coordinate,
  opacity: { type: "number", minimum: 0, maximum: 1 },
  fill: { type: "string" },
  stroke: { type: "string" },
  strokeWidth: { type: "number", minimum: 0, maximum: 1_000_000 },
  radius: { type: "number", minimum: 0, maximum: 1_000_000 },
  clip: { type: "boolean" },
  path: { type: "string", maxLength: 100_000 },
  fontSize: { type: "number", minimum: 0, maximum: 1_000_000 },
};
const scene = object(sceneFields, ["kind", "x", "y", "width", "height"]);
const overrides = {
  type: "object",
  additionalProperties: { type: "object", additionalProperties: json },
};
const instance = object({ definitionId: str, variant: str, overrides }, [
  "definitionId",
]);
const node = object(
  {
    id: str,
    type: str,
    props: { type: "object", additionalProperties: json },
    slots: {
      type: "object",
      additionalProperties: { type: "array", items: { $ref: "#/$defs/node" } },
    },
    name: str,
    hidden: { type: "boolean" },
    locked: { type: "boolean" },
    scene,
    instance,
  },
  ["id", "type", "props", "slots"],
);
const componentDefinition = object(
  {
    id: str,
    name: str,
    version: { type: "integer", minimum: 1 },
    nodes: { type: "array", items: { $ref: "#/$defs/node" } },
    variants: { type: "object", additionalProperties: overrides },
    properties: {
      type: "object",
      additionalProperties: object({ nodeId: str, prop: str, default: json }),
    },
  },
  ["id", "name", "version", "nodes"],
);
const designComponents = {
  type: "array",
  maxItems: 1000,
  items: componentDefinition,
};
const width = { type: "integer", minimum: 320, maximum: 3840 };
const height = { type: "integer", minimum: 240, maximum: 3840 };
const inset = { type: "integer", minimum: 0, maximum: 240 };
const device = object({
  preset: { type: "string", minLength: 1, maxLength: 100 },
  orientation: { enum: ["portrait", "landscape"] },
  cutout: { enum: ["none", "pill", "notch"] },
  safeArea: object({ top: inset, right: inset, bottom: inset, left: inset }),
});
const viewport = {
  ...object({ width, height, device }, ["width"]),
  dependentRequired: { device: ["height"] },
};
const provenance = object({ sourcePageId: str, sourceRevision: integer });
const annotation = {
  ...object(
    {
      id: str,
      pageId: str,
      nodeId: str,
      x: { type: "number", minimum: -1000000, maximum: 1000000 },
      y: { type: "number", minimum: -1000000, maximum: 1000000 },
      text: { ...str, maxLength: 10000 },
      status: { enum: ["open", "resolved"] },
      decision: { ...str, maxLength: 10000 },
      proposalId: str,
      createdAt: { ...str, format: "date-time" },
    },
    ["id", "text", "status", "createdAt"],
  ),
  dependentRequired: { x: ["y", "pageId"], y: ["x", "pageId"] },
};
const annotations = { type: "array", maxItems: 10000, items: annotation };
const page = object(
  {
    screenId: str,
    name: str,
    viewport,
    nodes: { type: "array", items: { $ref: "#/$defs/node" } },
    provenance,
  },
  ["screenId", "name", "viewport", "nodes"],
);
const tokens = {
  type: "object",
  additionalProperties: object(
    {
      type: { enum: ["color", "number", "dimension", "string", "fontFamily"] },
      value: json,
      themes: { type: "object", additionalProperties: json },
    },
    ["type", "value"],
  ),
};
const members = {
  type: "array",
  items: str,
  uniqueItems: true,
  maxItems: 10000,
};
const groups = {
  type: "array",
  maxItems: 100,
  items: object({
    id: { ...str, maxLength: 100 },
    name: { ...str, maxLength: 100 },
    pages: members,
    components: members,
    tokens: members,
  }),
};
export const projectSchema = {
  ...object(
    {
      schemaVersion: { const: 2 },
      projectId: str,
      name: str,
      revision: integer,
      pages: { type: "array", items: { $ref: "#/$defs/page" } },
      library: object({ id: str, version: str }),
      theme: str,
      tokens,
      groups,
      designComponents,
      annotations,
    },
    [
      "schemaVersion",
      "projectId",
      "name",
      "revision",
      "pages",
      "library",
      "theme",
      "tokens",
    ],
  ),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: { node, page, scene, componentDefinition },
};
const op = (
  type: string,
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => object({ type: { const: type }, ...properties }, ["type", ...required]);
const destination = { pageId: str, parentId: str, slot: str, index: integer };
export const batchSchema = {
  ...object(
    {
      requestId: str,
      baseRevision: integer,
      description: { type: "string" },
      author: { type: "string" },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 1000,
        items: {
          oneOf: [
            op(
              "setNodeMetadata",
              {
                nodeId: str,
                name: str,
                hidden: { type: "boolean" },
                locked: { type: "boolean" },
                scene: object(sceneFields, []),
              },
              ["nodeId"],
            ),
            op("setDesignComponents", { definitions: designComponents }),
            op("setInstance", { nodeId: str, instance }),
            op("detachInstance", { nodeId: str }),
            op("updateProps", {
              nodeId: str,
              props: { type: "object", additionalProperties: json },
            }),
            op(
              "insertNode",
              { ...destination, node: { $ref: "#/$defs/node" } },
              ["pageId", "index", "node"],
            ),
            op("moveNode", { ...destination, nodeId: str }, [
              "pageId",
              "index",
              "nodeId",
            ]),
            op("removeNode", { nodeId: str }),
            op(
              "setViewport",
              {
                pageId: str,
                width,
                height,
                device: { anyOf: [device, { type: "null" }] },
              },
              ["pageId", "width"],
            ),
            op("addPage", { page: { $ref: "#/$defs/page" } }),
            op("removePage", { pageId: str }),
            op("renamePage", { pageId: str, name: str }),
            op("setTheme", { theme: str }),
            op("setTokens", { tokens }),
            op("setGroups", { groups }),
            op("setAnnotations", { annotations }),
            op("duplicatePage", { pageId: str, newPageId: str, name: str }),
          ],
        },
      },
    },
    ["requestId", "baseRevision", "operations"],
  ),
  $defs: { node, page, scene, componentDefinition },
};
export function validateComponentProps(
  project: Project,
  metadata: unknown,
): void {
  if (!Array.isArray(metadata)) return;
  const library = (metadata as LibraryMetadata[]).find(
    (l) => l.id === project.library.id && l.version === project.library.version,
  );
  if (!library) return;
  const modes = new Set([
    project.theme ?? "light",
    ...(library.themes ?? []).map((theme) => theme.id),
    ...Object.values(project.tokens ?? {}).flatMap((token) =>
      Object.keys(token.themes ?? {}),
    ),
  ]);
  const resolvedModes = [...modes].map((mode) =>
    resolveTokens(project.tokens ?? {}, mode),
  );
  const walk = (nodes: ProjectNode[]) => {
    for (const node of nodes) {
      const component = library.components[node.type];
      if (component) {
        for (const [name, value] of Object.entries(node.props)) {
          const field = component.fields[name];
          if (!field) {
            if (name in component.defaultProps) continue;
            throw new Error(`INVALID_COMPONENT_PROP:${node.type}.${name}`);
          }
          const values =
            typeof value === "object" && value !== null && "$token" in value
              ? resolvedModes.map((tokens) => tokens[String(value.$token)])
              : [value];
          for (const resolved of values) {
            if (field.type === "json") continue;
            if (field.type === "select") {
              if (!field.options?.includes(String(resolved)))
                throw new Error(`INVALID_COMPONENT_PROP:${node.type}.${name}`);
            } else if (typeof resolved !== field.type)
              throw new Error(`INVALID_COMPONENT_PROP:${node.type}.${name}`);
            if (
              typeof resolved === "number" &&
              ((field.min !== undefined && resolved < field.min) ||
                (field.max !== undefined && resolved > field.max))
            )
              throw new Error(`INVALID_COMPONENT_PROP:${node.type}.${name}`);
          }
        }
      }
      for (const children of Object.values(node.slots)) walk(children);
    }
  };
  for (const page of project.pages) walk(page.nodes);
}
