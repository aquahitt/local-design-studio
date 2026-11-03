import type { ProjectNode } from "./project";
import type { FramePaintTree } from "./image-paint";
import { layerStyle } from "./layer-style";
import {
  compileFrameDecorationTree,
  frameContentClipStyle,
} from "./frame-paint";
export type DeclarativeTree = {
  tag: FramePaintTree["tag"] | "span";
  props: FramePaintTree["props"];
  children: DeclarativeTree[];
  text?: string;
};
export type PrimitivePresentation = {
  style: Record<string, string | number>;
  own?: DeclarativeTree;
  childClipStyle?: Record<string, string | number>;
};
/** Only canonical visual primitives; never executes an attached library. */
export function compilePrimitivePresentation(
  node: ProjectNode,
): PrimitivePresentation | undefined {
  const s = node.scene;
  if (s?.kind === "frame")
    return {
      style: layerStyle(node),
      own: compileFrameDecorationTree(node.id, s),
      childClipStyle: frameContentClipStyle(s),
    };
  if (s?.kind === "vector")
    return {
      style: layerStyle(node),
      own: {
        tag: "svg",
        props: {
          width: "100%",
          height: "100%",
          viewBox: `0 0 ${s.width} ${s.height}`,
          style: { overflow: "hidden" },
        },
        children: [
          {
            tag: "path",
            props: {
              d: s.path ?? "",
              fill: s.fill ?? "none",
              ...(s.stroke ? { stroke: s.stroke } : {}),
              strokeWidth: s.strokeWidth ?? 1,
            },
            children: [],
          },
        ],
      },
    };
  return undefined;
}
