import { frameShadowLocalBounds } from "./paint-bounds";
import { compileFramePaintTree, type FramePaintTree } from "./image-paint";
import { compileFrameStrokeTree } from "./stroke-paint";
import type { SceneMetadata } from "./scene";

/** Shared decoration only. No layout/selection wrapper or document-controlled code. */
export function compileFrameDecorationTree(
  nodeId: string,
  scene: SceneMetadata,
): FramePaintTree | undefined {
  const fill = compileFramePaintTree(nodeId, scene);
  const strokes = compileFrameStrokeTree(nodeId, scene);
  const metrics = frameShadowLocalBounds(scene);
  const bounds = metrics.bounds;
  const expanded =
    scene.kind === "frame" &&
    (bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.width > scene.width ||
      bounds.height > scene.height);
  const shadow: FramePaintTree | undefined = expanded
    ? {
        tag: "div",
        props: {
          "data-studio-metadata-clip": "true",
          style: {
            all: "initial",
            position: "absolute",
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            overflow: "clip",
            visibility: "hidden",
            pointerEvents: "none",
            padding: 0,
            border: 0,
            margin: 0,
          },
        },
        children: [
          {
            tag: "div",
            props: {
              "data-studio-paint-envelope": nodeId,
              "data-studio-envelope-policy": metrics.policy,
              "data-studio-envelope-status": metrics.status,
              style: {
                all: "initial",
                position: "absolute",
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
                visibility: "hidden",
                pointerEvents: "none",
                padding: 0,
                border: 0,
                margin: 0,
              },
            },
            children: [],
          },
        ],
      }
    : undefined;
  const children = [
    ...(fill ? [fill] : []),
    ...(strokes ? [strokes] : []),
    ...(shadow ? [shadow] : []),
  ];
  if (!children.length) return undefined;
  if (children.length === 1)
    return {
      ...children[0],
      props: { ...children[0].props, "data-studio-decoration-root": nodeId },
    };
  return {
    tag: "div",
    props: {
      "data-studio-decoration-root": nodeId,
      style: { display: "contents", pointerEvents: "none" },
    },
    children,
  };
}
/** A frame's own outline stays outside its child clip without shifting local origin. */
export function frameContentClipStyle(
  scene: SceneMetadata | undefined,
): Record<string, string | number> | undefined {
  return scene?.kind === "frame" && scene.strokes !== undefined && scene.clip
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: scene.radius ?? 0,
      }
    : undefined;
}
