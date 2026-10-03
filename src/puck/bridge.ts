import type { Data, ComponentData } from "@puckeditor/core";
import {
  definitions,
  parseScreen,
  type Kind,
  type Node,
  type Screen,
} from "../model/document";
export type PuckNode = {
  type: Kind;
  props: Record<string, unknown> & { id: string };
};
export type PilotData = {
  root: { props: Record<string, unknown> };
  content: PuckNode[];
};
export function toPuck(screen: Screen): PilotData {
  function convert(node: Node): PuckNode {
    const slots = Object.fromEntries(
      Object.entries(node.slots).map(([name, children]) => [
        name,
        children.map(convert),
      ]),
    );
    return { type: node.type, props: { ...node.props, ...slots, id: node.id } };
  }
  return { root: { props: {} }, content: screen.nodes.map(convert) };
}
export function fromPuck(data: Data, previous: Screen): Screen {
  function convert(node: ComponentData): Node {
    if (!Object.hasOwn(definitions, node.type))
      throw new Error("UNKNOWN_COMPONENT");
    const type = node.type as Kind;
    const definition = definitions[type];
    const props = Object.fromEntries(
      definition.fields.map((name) => [name, node.props[name]]),
    );
    const slots = Object.fromEntries(
      definition.slots.map((name) => {
        const children = node.props[name];
        if (!Array.isArray(children)) throw new Error("INVALID_SLOT");
        return [name, children.map(convert)];
      }),
    );
    return { id: node.props.id, type, props: props as Node["props"], slots };
  }
  return parseScreen({ ...previous, nodes: data.content.map(convert) });
}
