import { compileFramePaintTree, type FramePaintTree } from "./image-paint";
import {
  compilePaintGradient,
  validateFramePaint,
  paintContributes,
} from "./paint";
import type { SceneMetadata } from "./scene";

const branch = (
  tag: FramePaintTree["tag"],
  props: FramePaintTree["props"],
  children: FramePaintTree[] = [],
): FramePaintTree => ({ tag, props, children });

/** Encode the complete tuple, including its domain, without lossy ID sanitization. */
function strokeId(
  nodeId: string,
  paintId: string,
  domain: "clip" | "image",
): string {
  const input = JSON.stringify([nodeId, "stroke", paintId, domain]);
  let id = `stroke-${domain}-`;
  for (let index = 0; index < input.length; index++)
    id += input.charCodeAt(index).toString(16).padStart(4, "0");
  return id;
}

/** A legal document node ID can equal our surrogate ID; reserve emitted SVG IDs too. */
function scopeImageIds(tree: FramePaintTree, prefix: string): FramePaintTree {
  const ids = new Map<string, string>();
  function collect(node: FramePaintTree): void {
    if (typeof node.props.id === "string")
      ids.set(node.props.id, `${prefix}-${ids.size}`);
    node.children.forEach(collect);
  }
  collect(tree);
  function scoped(node: FramePaintTree): FramePaintTree {
    const props = { ...node.props };
    for (const [key, value] of Object.entries(props)) {
      if (typeof value !== "string") continue;
      if (key === "id") props[key] = ids.get(value) ?? value;
      else if (value.startsWith("url(#") && value.endsWith(")")) {
        const id = ids.get(value.slice(5, -1));
        if (id) props[key] = `url(#${id})`;
      }
    }
    return { ...node, props, children: node.children.map(scoped) };
  }
  return scoped(tree);
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const right = x + width,
    bottom = y + height;
  if (radius === 0) return `M ${x} ${y} H ${right} V ${bottom} H ${x} Z`;
  return [
    `M ${x + radius} ${y} H ${right - radius}`,
    `A ${radius} ${radius} 0 0 1 ${right} ${y + radius}`,
    `V ${bottom - radius} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
    `H ${x + radius} A ${radius} ${radius} 0 0 1 ${x} ${bottom - radius}`,
    `V ${y + radius} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`,
  ].join(" ");
}

/** Pure overlay descriptor shared by the editor and handoff; frame origin is unchanged. */
export function compileFrameStrokeTree(
  nodeId: string,
  scene: SceneMetadata,
): FramePaintTree | undefined {
  validateFramePaint(scene, "scene");
  if (scene.kind !== "frame") return undefined;
  const strokes = scene.strokes?.filter(
    (stroke) => paintContributes(stroke) && stroke.width > 0,
  );
  if (!strokes?.length) return undefined;

  const definitions: FramePaintTree[] = [],
    layers: FramePaintTree[] = [];
  const radius = Math.min(scene.radius ?? 0, scene.width / 2, scene.height / 2);
  for (const stroke of [...strokes].reverse()) {
    const outset =
      stroke.alignment === "outside"
        ? stroke.width
        : stroke.alignment === "center"
          ? stroke.width / 2
          : 0;
    const inset = stroke.width - outset;
    const width = scene.width + 2 * outset,
      height = scene.height + 2 * outset;
    if (width <= 0 || height <= 0) continue;
    // Square frames retain square/miter corners; only rounded corners offset as arcs.
    const outerRadius = radius === 0 ? 0 : radius + outset;
    let path = roundedRectPath(0, 0, width, height, outerRadius);
    const innerWidth = scene.width - 2 * inset,
      innerHeight = scene.height - 2 * inset;
    if (innerWidth > 0 && innerHeight > 0)
      path += ` ${roundedRectPath(outset + inset, outset + inset, innerWidth, innerHeight, Math.max(0, radius - inset))}`;
    const clipId = strokeId(nodeId, stroke.id, "clip");
    definitions.push(
      branch("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" }, [
        branch("path", { d: path, fillRule: "evenodd", clipRule: "evenodd" }),
      ]),
    );

    const style: Record<string, string | number> = {
      position: "absolute",
      left: -outset,
      top: -outset,
      width,
      height,
      pointerEvents: "none",
      clipPath: `url(#${clipId})`,
      mixBlendMode: stroke.blendMode ?? "normal",
    };
    let children: FramePaintTree[] = [];
    if (stroke.kind === "image") {
      // Mapping coordinates belong to this outer paint box. The ring alone clips it.
      // Blend on the envelope so the nested image group's isolation cannot hide fills.
      const {
        width: _width,
        alignment: _alignment,
        blendMode: _blendMode,
        ...paint
      } = stroke;
      const tree = compileFramePaintTree(strokeId(nodeId, stroke.id, "image"), {
        kind: "frame",
        x: 0,
        y: 0,
        width,
        height,
        fills: [paint],
      });
      if (tree)
        children = [scopeImageIds(tree, strokeId(nodeId, stroke.id, "image"))];
    } else style.backgroundImage = compilePaintGradient(stroke);
    layers.push(
      branch("div", { style, "data-studio-paint-envelope": nodeId }, children),
    );
  }
  if (!layers.length) return undefined;
  return branch(
    "div",
    {
      style: {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      },
    },
    [
      branch(
        "svg",
        {
          xmlns: "http://www.w3.org/2000/svg",
          width: 0,
          height: 0,
          style: { position: "absolute", overflow: "visible" },
        },
        [branch("defs", {}, definitions)],
      ),
      ...layers,
    ],
  );
}
