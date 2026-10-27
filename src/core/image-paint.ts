import {
  compilePaintGradient,
  compileFrameInsetEffects,
  hasLayeredFramePaint,
  validateFramePaint,
  validateImageMapping,
  type ImageMapping,
} from "./paint";
import { validateAffineLinear, AFFINE_LIMITS } from "./affine-validation";
import { CoreError } from "./tokens";
import type { SceneMetadata, Matrix } from "./scene";
import type { ProjectNode } from "./project";
export { hasLayeredFramePaint } from "./paint";
export type ImagePaintReference = { nodeId: string; paintId: string; asset: string };
export type FramePaintTree = {
  tag: "div" | "img" | "svg" | "defs" | "pattern" | "image" | "rect";
  props: Record<string, string | number | Record<string, string | number>>;
  children: FramePaintTree[];
};
const branch = (
  tag: FramePaintTree["tag"],
  props: FramePaintTree["props"],
  children: FramePaintTree[] = []
): FramePaintTree => ({ tag, props, children });
export function imageMappingMatrix(
  mapping: ImageMapping,
  decoded: { width: number; height: number },
  frame: { width: number; height: number }
): Matrix {
  validateImageMapping(mapping, "mapping");
  if ("imageToFrame" in mapping) return [...mapping.imageToFrame];
  for (const value of [decoded.width, decoded.height, frame.width, frame.height])
    if (!Number.isFinite(value) || value <= 0)
      throw new CoreError("INVALID_SCENE", "mapping", "mapping");
  const scale = (mapping.mode === "cover" ? Math.max : Math.min)(
    frame.width / decoded.width,
    frame.height / decoded.height
  );
  const width = decoded.width * scale,
    height = decoded.height * scale;
  const result: Matrix = [
    width,
    0,
    0,
    height,
    (frame.width - width) * mapping.anchor.x,
    (frame.height - height) * mapping.anchor.y,
  ];
  validateAffineLinear(result.slice(0, 4), "mapping");
  if (result.some((n) => !Number.isFinite(n) || Math.abs(n) > AFFINE_LIMITS.maxCoefficient))
    throw new CoreError("INVALID_SCENE", "mapping", "mapping");
  return result;
}
function uniqueId(nodeId: string, paintId: string): string {
  const input = JSON.stringify([nodeId, paintId]);
  let result = "paint-";
  for (let i = 0; i < input.length; i++)
    result += input.charCodeAt(i).toString(16).padStart(4, "0");
  return result;
}
export function compileFramePaintTree(
  nodeId: string,
  scene: SceneMetadata
): FramePaintTree | undefined {
  validateFramePaint(scene, "scene");
  if (!hasLayeredFramePaint(scene)) return undefined;
  const full = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  };
  const children: FramePaintTree[] = [];
  for (const paint of [...(scene.fills ?? [])].reverse()) {
    if (paint.enabled === false) continue;
    const style: Record<string, string | number> = {
      ...full,
      opacity: paint.opacity ?? 1,
      mixBlendMode: paint.blendMode ?? "normal",
    };
    if (paint.kind !== "image") {
      children.push(
        branch("div", {
          style: { ...style, opacity: 1, backgroundImage: compilePaintGradient(paint) },
        })
      );
      continue;
    }
    const mapping = paint.mapping;
    if ("anchor" in mapping) {
      children.push(
        branch("div", { style }, [
          branch("img", {
            src: paint.asset,
            alt: "",
            style: {
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: mapping.mode,
              objectPosition: `${mapping.anchor.x * 100}% ${mapping.anchor.y * 100}%`,
            },
          }),
        ])
      );
      continue;
    }
    const matrix = `matrix(${mapping.imageToFrame.join(" ")})`;
    const image = branch("image", {
      href: paint.asset,
      width: 1,
      height: 1,
      preserveAspectRatio: "none",
      ...(mapping.mode === "crop" ? { transform: matrix } : {}),
    });
    const svgChildren: FramePaintTree[] =
      mapping.mode === "crop"
        ? [image]
        : [
            branch("defs", {}, [
              branch(
                "pattern",
                {
                  id: uniqueId(nodeId, paint.id),
                  patternUnits: "userSpaceOnUse",
                  width: 1,
                  height: 1,
                  patternTransform: matrix,
                },
                [image]
              ),
            ]),
            branch("rect", {
              width: scene.width,
              height: scene.height,
              fill: `url(#${uniqueId(nodeId, paint.id)})`,
            }),
          ];
    children.push(
      branch("div", { style }, [
        branch(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: `0 0 ${scene.width} ${scene.height}`,
            preserveAspectRatio: "none",
            style: { display: "block", width: "100%", height: "100%", overflow: "hidden" },
          },
          svgChildren
        ),
      ])
    );
  }
  const effects = compileFrameInsetEffects(scene);
  if (Object.keys(effects).length)
    children.push(branch("div", { style: { ...full, borderRadius: "inherit", ...effects } }));
  return branch(
    "div",
    {
      style: { ...full, isolation: "isolate", overflow: "hidden", borderRadius: scene.radius ?? 0 },
    },
    children
  );
}
export function collectImagePaintReferences(
  nodes: readonly ProjectNode[],
  mode: "all" | "rendered" = "rendered"
): ImagePaintReference[] {
  const refs: ImagePaintReference[] = [],
    seen = new Set<string>();
  function walk(nodes: readonly ProjectNode[]) {
    for (const node of nodes) {
      if (mode === "rendered" && node.hidden) continue;
      for (const paint of node.scene?.fills ?? [])
        if (paint.kind === "image" && (mode === "all" || paint.enabled !== false)) {
          const key = JSON.stringify([node.id, paint.id, paint.asset]);
          if (!seen.has(key)) {
            seen.add(key);
            refs.push({ nodeId: node.id, paintId: paint.id, asset: paint.asset });
          }
        }
      for (const slot of Object.keys(node.slots).sort()) walk(node.slots[slot]);
    }
  }
  walk(nodes);
  return refs;
}
