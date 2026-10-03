export const definitions = {
  Stack: { fields: ["gap"], slots: ["content"] },
  Card: { fields: ["title"], slots: ["content"] },
  Text: { fields: ["text"], slots: [] },
  Button: { fields: ["label"], slots: [] },
  Metric: { fields: ["label", "value"], slots: [] },
} as const;
export type Kind = keyof typeof definitions;
export type Node = {
  id: string;
  type: Kind;
  props: Record<string, string | number>;
  slots: Record<string, Node[]>;
};
export type Screen = {
  schemaVersion: 1;
  screenId: string;
  revision: number;
  name: string;
  viewport: { width: number };
  nodes: Node[];
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_OBJECT");
  }
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("UNKNOWN_FIELD");
  }
}
export function parseScreen(input: unknown): Screen {
  const doc = object(input);
  exact(doc, [
    "schemaVersion",
    "screenId",
    "revision",
    "name",
    "viewport",
    "nodes",
  ]);
  const viewport = object(doc.viewport);
  exact(viewport, ["width"]);
  if (
    doc.schemaVersion !== 1 ||
    typeof doc.screenId !== "string" ||
    !doc.screenId ||
    typeof doc.name !== "string" ||
    !Number.isInteger(doc.revision) ||
    (doc.revision as number) < 0 ||
    typeof viewport.width !== "number" ||
    !Number.isInteger(viewport.width) ||
    viewport.width < 320 ||
    viewport.width > 1920 ||
    !Array.isArray(doc.nodes)
  ) {
    throw new Error("INVALID_SCREEN");
  }
  const ids = new Set<string>();
  function node(input: unknown): Node {
    const value = object(input);
    exact(value, ["id", "type", "props", "slots"]);
    if (typeof value.id !== "string" || !value.id || ids.has(value.id)) {
      throw new Error("INVALID_NODE_ID");
    }
    ids.add(value.id);
    if (
      typeof value.type !== "string" ||
      !Object.hasOwn(definitions, value.type)
    )
      throw new Error("UNKNOWN_COMPONENT");
    const type = value.type as Kind;
    const definition = definitions[type];
    const props = object(value.props);
    exact(props, definition.fields);
    for (const field of definition.fields) {
      const prop = props[field];
      if (field === "gap") {
        if (
          typeof prop !== "number" ||
          !Number.isFinite(prop) ||
          prop < 0 ||
          prop > 64
        ) {
          throw new Error("INVALID_GAP");
        }
      } else if (typeof prop !== "string" || prop.length > 1000) {
        throw new Error("INVALID_TEXT");
      }
    }
    const slots = object(value.slots);
    exact(slots, definition.slots);
    const parsedSlots: Record<string, Node[]> = {};
    for (const slot of definition.slots) {
      if (!Array.isArray(slots[slot])) throw new Error("INVALID_SLOT");
      parsedSlots[slot] = (slots[slot] as unknown[]).map(node);
    }
    return {
      id: value.id,
      type,
      props: props as Node["props"],
      slots: parsedSlots,
    };
  }
  return {
    schemaVersion: 1,
    screenId: doc.screenId,
    revision: doc.revision as number,
    name: doc.name,
    viewport: { width: viewport.width },
    nodes: doc.nodes.map(node),
  };
}
