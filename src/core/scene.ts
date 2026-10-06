import { CoreError } from "./tokens";
import type { ProjectNode } from "./project";

/** Scene coordinates are CSS pixels in the parent's local coordinate system. */
export type SceneMetadata = {
  kind: "frame" | "text" | "vector" | "component" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  clip?: boolean;
  path?: string;
  fontSize?: number;
};
export type Point = { x: number; y: number };
export type SceneView = { zoom: number; panX: number; panY: number };
export type Matrix = [number, number, number, number, number, number];
export type SceneLayer = {
  node: ProjectNode;
  transform: Matrix;
  hidden: boolean;
  locked: boolean;
  clips: { transform: Matrix; width: number; height: number }[];
};

export function validateScene(value: unknown, path: string): SceneMetadata {
  const fail = () => {
    throw new CoreError("INVALID_SCENE", path, path);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const scene = value as Record<string, unknown>;
  const fields = [
    "kind",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
    "fill",
    "stroke",
    "strokeWidth",
    "radius",
    "clip",
    "path",
    "fontSize",
  ];
  if (Object.keys(scene).some((key) => !fields.includes(key))) fail();
  if (
    !["frame", "text", "vector", "component", "image"].includes(
      String(scene.kind),
    )
  )
    fail();
  for (const key of ["x", "y", "width", "height"]) {
    if (
      typeof scene[key] !== "number" ||
      !Number.isFinite(scene[key]) ||
      Math.abs(scene[key] as number) > 1_000_000
    )
      fail();
  }
  if ((scene.width as number) <= 0 || (scene.height as number) <= 0) fail();
  for (const key of [
    "rotation",
    "opacity",
    "strokeWidth",
    "radius",
    "fontSize",
  ]) {
    const number = scene[key];
    if (
      number !== undefined &&
      (typeof number !== "number" ||
        !Number.isFinite(number) ||
        Math.abs(number) > 1_000_000)
    )
      fail();
    if (typeof number === "number" && key !== "rotation" && number < 0) fail();
  }
  if (typeof scene.opacity === "number" && scene.opacity > 1) fail();
  if (scene.clip !== undefined && typeof scene.clip !== "boolean") fail();
  // Paint is declarative: no CSS url(), executable URLs, markup or arbitrary CSS.
  for (const key of ["fill", "stroke"]) {
    const paint = scene[key];
    if (
      paint !== undefined &&
      (typeof paint !== "string" ||
        !/^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\))$/i.test(
          paint,
        ))
    )
      fail();
  }
  if (
    scene.path !== undefined &&
    (scene.kind !== "vector" ||
      typeof scene.path !== "string" ||
      scene.path.length > 100_000 ||
      !/^[MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]+$/.test(scene.path))
  )
    fail();
  return scene as SceneMetadata;
}

function validateView(view: SceneView): void {
  if (
    !Number.isFinite(view.zoom) ||
    view.zoom <= 0 ||
    !Number.isFinite(view.panX) ||
    !Number.isFinite(view.panY)
  )
    throw new CoreError("INVALID_SCENE_VIEW");
}
export function screenToWorld(point: Point, view: SceneView): Point {
  validateView(view);
  return {
    x: (point.x - view.panX) / view.zoom,
    y: (point.y - view.panY) / view.zoom,
  };
}
export function worldToScreen(point: Point, view: SceneView): Point {
  validateView(view);
  return {
    x: point.x * view.zoom + view.panX,
    y: point.y * view.zoom + view.panY,
  };
}
export function multiplyTransforms(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transformPoint(point: Point, matrix: Matrix): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}
export function inverseTransform(matrix: Matrix): Matrix {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!determinant) throw new CoreError("INVALID_TRANSFORM");
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}
export function nodeTransform(node: ProjectNode): Matrix {
  if (!node.scene) return [1, 0, 0, 1, 0, 0];
  const radians = ((node.scene.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  return [cos, sin, -sin, cos, node.scene.x, node.scene.y];
}
export function sceneLayers(nodes: ProjectNode[]): SceneLayer[] {
  const result: SceneLayer[] = [];
  function walk(
    nodes: ProjectNode[],
    transform: Matrix,
    hidden: boolean,
    locked: boolean,
    clips: SceneLayer["clips"],
  ) {
    for (const node of nodes) {
      const layer = {
        node,
        transform: multiplyTransforms(transform, nodeTransform(node)),
        hidden: hidden || !!node.hidden,
        locked: locked || !!node.locked,
        clips,
      };
      result.push(layer);
      const childClips = node.scene?.clip
        ? [
            ...clips,
            {
              transform: layer.transform,
              width: node.scene.width,
              height: node.scene.height,
            },
          ]
        : clips;
      for (const children of Object.values(node.slots))
        walk(children, layer.transform, layer.hidden, layer.locked, childClips);
    }
  }
  walk(nodes, [1, 0, 0, 1, 0, 0], false, false, []);
  return result;
}
function contains(
  point: Point,
  transform: Matrix,
  width: number,
  height: number,
): boolean {
  const local = transformPoint(point, inverseTransform(transform));
  return local.x >= 0 && local.y >= 0 && local.x <= width && local.y <= height;
}
/** Bounding-box picking; vector path interiors and glyph outlines are not sampled. */
export function hitTestScene(
  nodes: ProjectNode[],
  point: Point,
): string | undefined {
  const layers = sceneLayers(nodes);
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index],
      scene = layer.node.scene;
    if (!scene || layer.hidden || layer.locked || scene.opacity === 0) continue;
    if (
      layer.clips.some(
        (clip) => !contains(point, clip.transform, clip.width, clip.height),
      )
    )
      continue;
    if (contains(point, layer.transform, scene.width, scene.height))
      return layer.node.id;
  }
}
