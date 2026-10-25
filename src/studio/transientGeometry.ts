import type { Operation } from "../core/operations";
import { CoreError, type Project, type ProjectNode } from "../core/project";
import { validateScene, type SceneGeometry } from "../core/scene";
export type SceneGeometryMap = Readonly<Record<string, SceneGeometry>>;
type GeometryOperation = Extract<Operation, { type: "setNodeGeometry" }>;
export type GeometryResult = {
  operations: GeometryOperation[];
  geometry: SceneGeometryMap;
};
const fields = ["x", "y", "width", "height", "rotation", "linearTransform"];
const unsafe = /^(?:__proto__|prototype|constructor)$/i;
function fail(): never {
  throw new CoreError("INVALID_TRANSIENT_GEOMETRY");
}
/** Geometry map labels are canonical IDs, including reserved-looking strings.
 * Own data descriptors and a plain prototype keep them inert after postMessage. */
function geometryMapRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === "string" &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
    )
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    geometryMapRecord(value) &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === "string" && !unsafe.test(key),
    )
  );
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !keys.includes(key),
    )
  )
    fail();
}
function replacement(node: ProjectNode, value: unknown): ProjectNode {
  if (!node.scene || !record(value)) fail();
  exact(value, fields);
  if (["x", "y", "width", "height"].some((key) => !Object.hasOwn(value, key)))
    fail();
  const linear = value.linearTransform;
  if (
    linear !== undefined &&
    (!Array.isArray(linear) ||
      linear.length !== 4 ||
      Reflect.ownKeys(linear).some(
        (key) =>
          !["0", "1", "2", "3", "length"].includes(String(key)) ||
          typeof key !== "string",
      ) ||
      [0, 1, 2, 3].some(
        (index) =>
          !Object.hasOwn(linear, index) ||
          !Object.hasOwn(
            Object.getOwnPropertyDescriptor(linear, String(index))!,
            "value",
          ),
      ))
  )
    fail();
  const {
    x: _x,
    y: _y,
    width: _w,
    height: _h,
    rotation: _r,
    linearTransform: _l,
    ...rest
  } = node.scene;
  const scene = validateScene({ ...rest, ...value }, `node.${node.id}.scene`);
  return {
    ...node,
    scene: {
      ...scene,
      ...(scene.linearTransform
        ? {
            linearTransform: [...scene.linearTransform] as [
              number,
              number,
              number,
              number,
            ],
          }
        : {}),
    },
  };
}
function indexNodes(nodes: ProjectNode[]): Map<string, ProjectNode> {
  const result = new Map<string, ProjectNode>();
  function walk(rows: ProjectNode[], depth: number) {
    if (!Array.isArray(rows) || depth > 64) fail();
    for (const node of rows) {
      if (
        !node ||
        typeof node.id !== "string" ||
        result.has(node.id) ||
        result.size >= 10000
      )
        fail();
      result.set(node.id, node);
      for (const children of Object.values(node.slots))
        walk(children, depth + 1);
    }
  }
  walk(nodes, 0);
  return result;
}
function copiedGeometry(node: ProjectNode): SceneGeometry {
  const scene = node.scene!;
  return {
    x: scene.x,
    y: scene.y,
    width: scene.width,
    height: scene.height,
    ...(scene.rotation !== undefined ? { rotation: scene.rotation } : {}),
    ...(scene.linearTransform !== undefined
      ? {
          linearTransform: [...scene.linearTransform] as [
            number,
            number,
            number,
            number,
          ],
        }
      : {}),
  };
}
export function geometryResult(
  operations: readonly Operation[],
  capturedProject: Project,
  pageId: string,
  rootIds: readonly string[],
): GeometryResult {
  const page = capturedProject.pages.find((page) => page.screenId === pageId);
  if (
    !page ||
    !Array.isArray(operations) ||
    operations.length > 10000 ||
    !Array.isArray(rootIds) ||
    new Set(rootIds).size !== rootIds.length
  )
    fail();
  const canonical = indexNodes(page.nodes),
    roots = new Set(rootIds),
    seen = new Set<string>();
  if (rootIds.some((id) => !canonical.get(id)?.scene)) fail();
  const output: GeometryOperation[] = [];
  const geometry: Record<string, SceneGeometry> = Object.create(null);
  for (const operation of operations) {
    if (!record(operation)) fail();
    exact(operation, ["type", "nodeId", "geometry"]);
    if (
      operation.type !== "setNodeGeometry" ||
      typeof operation.nodeId !== "string" ||
      !Object.hasOwn(operation, "geometry") ||
      !roots.has(operation.nodeId) ||
      seen.has(operation.nodeId)
    )
      fail();
    const node = canonical.get(operation.nodeId);
    if (!node) fail();
    seen.add(operation.nodeId);
    const next = copiedGeometry(replacement(node, operation.geometry));
    geometry[operation.nodeId] = next;
    output.push({
      type: "setNodeGeometry",
      nodeId: operation.nodeId,
      geometry: {
        ...next,
        ...(next.linearTransform
          ? {
              linearTransform: [...next.linearTransform] as [
                number,
                number,
                number,
                number,
              ],
            }
          : {}),
      },
    });
  }
  return { operations: output, geometry };
}
/** Only geometry changes; content/slots/instances and the source document retain identity. */
export function withTransientGeometry(
  node: ProjectNode,
  geometry: SceneGeometryMap = {},
): ProjectNode {
  const prototype = Object.getPrototypeOf(geometry);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptor = Object.getOwnPropertyDescriptor(geometry, node.id);
  if (!descriptor) return node;
  if (!Object.hasOwn(descriptor, "value")) fail();
  return replacement(node, descriptor.value);
}
/** Canvas is a closed protocol, unlike the separately supplied trusted component runtime. */
export function validCanvasRender(
  canvas: unknown,
  project: Project,
  nodes: ProjectNode[] | undefined,
): boolean {
  try {
    if (!record(canvas)) return false;
    exact(canvas, ["surfaceId", "epoch", "view", "geometry"]);
    if (
      typeof canvas.surfaceId !== "string" ||
      !canvas.surfaceId.length ||
      canvas.surfaceId.length > 128 ||
      !Number.isSafeInteger(canvas.epoch) ||
      (canvas.epoch as number) < 0 ||
      !Number.isSafeInteger(project.revision) ||
      project.revision < 0 ||
      !record(canvas.view) ||
      !geometryMapRecord(canvas.geometry === undefined ? {} : canvas.geometry)
    )
      return false;
    exact(canvas.view, ["zoom", "panX", "panY"]);
    const { zoom, panX, panY } = canvas.view;
    if (
      typeof zoom !== "number" ||
      !Number.isFinite(zoom) ||
      zoom < 0.05 ||
      zoom > 16 ||
      [panX, panY].some(
        (n) =>
          typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9,
      )
    )
      return false;
    const actual = indexNodes(nodes ?? []),
      ids = [...actual.keys()];
    const page = project.pages.find((page) => {
      const canonical = indexNodes(page.nodes);
      return (
        canonical.size === ids.length && ids.every((id) => canonical.has(id))
      );
    });
    if (!page) return false;
    const map = (
      canvas.geometry === undefined ? {} : canvas.geometry
    ) as Record<string, unknown>;
    const operations = Object.keys(map).map((nodeId) => ({
      type: "setNodeGeometry",
      nodeId,
      geometry: map[nodeId],
    })) as GeometryOperation[];
    geometryResult(
      operations,
      project,
      page.screenId,
      [...actual.values()].filter((node) => node.scene).map((node) => node.id),
    );
    return true;
  } catch {
    return false;
  }
}
