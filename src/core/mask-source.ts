import { CoreError, type Project, type ProjectNode } from "./project";
import {
  collectImagePaintReferences,
  type ImagePaintReference,
} from "./image-paint";
import {
  frameShadowLocalBounds,
  frameStrokeLocalBounds,
  projectPaintBounds,
  type PaintBounds,
} from "./paint-bounds";
import { nodeTransform, multiplyTransforms, type Matrix } from "./scene";
import {
  compilePrimitivePresentation,
  type DeclarativeTree,
} from "./primitive-presentation";
export type MaskDiagnostic = {
  code:
    "MASK_SOURCE_UNSUPPORTED" | "MASK_SOURCE_LIMIT" | "MASK_IMAGE_UNAVAILABLE";
  nodeId?: string;
  feature: string;
};
export type MaskDescriptor = {
  version: 1;
  maskId: string;
  sourceId: string;
  mode: "alpha" | "luminance";
  bounds: PaintBounds;
  groupSize: { width: number; height: number };
  tree?: DeclarativeTree;
  resources: ImagePaintReference[];
  diagnostics: MaskDiagnostic[];
  boundsPolicy: string;
};
const dependentColors = new Set([
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "canvas",
  "canvastext",
  "linktext",
  "visitedtext",
  "activetext",
  "buttonface",
  "buttontext",
  "buttonborder",
  "field",
  "fieldtext",
  "highlight",
  "highlighttext",
  "selecteditem",
  "selecteditemtext",
  "mark",
  "marktext",
  "graytext",
  "accentcolor",
  "accentcolortext",
]);
// CSS Color 4 Appendix A maps these legacy names to environment-dependent system colors.
for (const name of [
  "ActiveBorder",
  "ActiveCaption",
  "AppWorkspace",
  "Background",
  "ButtonHighlight",
  "ButtonShadow",
  "CaptionText",
  "InactiveBorder",
  "InactiveCaption",
  "InactiveCaptionText",
  "InfoBackground",
  "InfoText",
  "Menu",
  "MenuText",
  "Scrollbar",
  "ThreeDDarkShadow",
  "ThreeDFace",
  "ThreeDHighlight",
  "ThreeDLightShadow",
  "ThreeDShadow",
  "Window",
  "WindowFrame",
  "WindowText",
])
  dependentColors.add(name.toLowerCase());
function union(a: PaintBounds, b: PaintBounds): PaintBounds {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
function intersect(a: PaintBounds, b: PaintBounds): PaintBounds {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}
/** Snapshot input must already be materialized. Bounds are in the mask group's local coordinates. */
export function compileMaskSource(
  _project: Project,
  mask: ProjectNode,
): MaskDescriptor {
  if (mask.scene?.kind !== "mask")
    throw new CoreError("NODE_NOT_MASK", mask.id);
  const sources = mask.slots.children?.filter((n) => n.maskSource);
  if (sources?.length !== 1)
    throw new CoreError("INVALID_MASK_SOURCE", mask.id);
  const source = sources[0];
  const diagnostics: MaskDiagnostic[] = [],
    resources: ImagePaintReference[] = [];
  let bounds: PaintBounds | undefined,
    count = 0;
  const add = (box: PaintBounds, clips: PaintBounds[]) => {
    for (const clip of clips) box = intersect(box, clip);
    if (box.width > 0 && box.height > 0)
      bounds = bounds ? union(bounds, box) : box;
  };
  const walk = (
    node: ProjectNode,
    parent: Matrix,
    clips: PaintBounds[],
    depth: number,
  ): DeclarativeTree | undefined => {
    if (node.hidden || node.scene?.opacity === 0) return undefined;
    if (++count > 10000 || depth > 64) {
      diagnostics.push({
        code: "MASK_SOURCE_LIMIT",
        nodeId: node.id,
        feature: "tree-limit",
      });
      return undefined;
    }
    const presentation = compilePrimitivePresentation(node);
    if (!presentation || !node.scene) {
      diagnostics.push({
        code: "MASK_SOURCE_UNSUPPORTED",
        nodeId: node.id,
        feature: "primitive-kind",
      });
      return undefined;
    }
    const scene = node.scene;
    if (
      [scene.fill, scene.stroke].some(
        (color) => color && dependentColors.has(color.toLowerCase()),
      )
    )
      diagnostics.push({
        code: "MASK_SOURCE_UNSUPPORTED",
        nodeId: node.id,
        feature: "context-color",
      });
    const world = multiplyTransforms(parent, nodeTransform(node));
    const local =
      scene.kind === "frame"
        ? union(
            frameShadowLocalBounds(scene).bounds,
            frameStrokeLocalBounds(scene),
          )
        : { x: 0, y: 0, width: scene.width, height: scene.height };
    add(projectPaintBounds(local, world), clips);
    resources.push(
      ...collectImagePaintReferences([{ ...node, slots: {} }], "rendered"),
    );
    const children: DeclarativeTree[] = [];
    if (presentation.own) children.push(presentation.own);
    if (scene.kind === "frame") {
      const childClips = scene.clip
        ? [
            ...clips,
            projectPaintBounds(
              { x: 0, y: 0, width: scene.width, height: scene.height },
              world,
            ),
          ]
        : clips;
      const content = Object.values(node.slots).flatMap((rows) =>
        rows.flatMap((child) => {
          const tree = walk(child, world, childClips, depth + 1);
          return tree ? [tree] : [];
        }),
      );
      if (presentation.childClipStyle)
        children.push({
          tag: "div",
          props: { style: presentation.childClipStyle },
          children: content,
        });
      else children.push(...content);
    }
    return { tag: "div", props: { style: presentation.style }, children };
  };
  const tree = walk(source, [1, 0, 0, 1, 0, 0], [], 0);
  let envelope = bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.floor(envelope.x),
    y = Math.floor(envelope.y);
  envelope = {
    x,
    y,
    width: Math.ceil(envelope.x + envelope.width) - x,
    height: Math.ceil(envelope.y + envelope.height) - y,
  };
  if (
    ![envelope.x, envelope.y, envelope.width, envelope.height].every(
      Number.isFinite,
    ) ||
    envelope.width > 8192 ||
    envelope.height > 8192 ||
    envelope.width * envelope.height > 16777216
  )
    diagnostics.push({
      code: "MASK_SOURCE_LIMIT",
      nodeId: source.id,
      feature: "surface-limit",
    });
  return {
    version: 1,
    maskId: mask.id,
    sourceId: source.id,
    mode: mask.scene.maskMode!,
    bounds: envelope,
    groupSize: { width: mask.scene.width, height: mask.scene.height },
    tree,
    resources,
    diagnostics: diagnostics.slice(0, 100),
    boundsPolicy:
      "conservative-affine-aabb/css-raster-envelope-6sigma-plus-2px",
  };
}
