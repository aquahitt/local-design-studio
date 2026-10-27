import { CoreError } from "./tokens";
import { sceneLayers, transformPoint, type Point } from "./scene";
import type { ProjectNode } from "./project";
import type { TransformGesture } from "./transform-gesture";

export const SNAP_THRESHOLDS = Object.freeze({ enter: 6, release: 9 });
type Axis = "x" | "y";
type Feature = "start" | "center" | "end";
type GuideInput = { id: string; axis: Axis; position: number };
export type SnapLine = Readonly<{
  id: string;
  axis: Axis;
  position: number;
  kind: "guide" | "object";
  nodeId?: string;
  guideId?: string;
}>;
export type SnapIndex = Readonly<{
  source: TransformGesture;
  x: readonly SnapLine[];
  y: readonly SnapLine[];
  byId: Readonly<Record<string, SnapLine | undefined>>;
}>;
export type SnapState = Readonly<
  Partial<Record<Axis, Readonly<{ targetId: string; feature: Feature }>>>
>;
export type SnapMatch = SnapLine & { feature: Feature };
const features: Feature[] = ["start", "center", "end"];
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Static, physical model targets. No DOM bounds, portals or moving descendants. */
export function buildSnapIndex(
  gesture: TransformGesture,
  options: { guides?: readonly GuideInput[] } = {},
): SnapIndex {
  const page = gesture.project.pages.find(
    (page) => page.screenId === gesture.pageId,
  );
  if (!page) throw new CoreError("PAGE_NOT_FOUND");
  const roots = new Set(gesture.frame.rootIds),
    excluded = new Set<string>();
  function walk(nodes: readonly ProjectNode[], moving = false) {
    for (const node of nodes) {
      const own = moving || roots.has(node.id);
      if (own) excluded.add(node.id);
      for (const children of Object.values(node.slots)) walk(children, own);
    }
  }
  walk(page.nodes);
  const x: SnapLine[] = [],
    y: SnapLine[] = [];
  const append = (line: SnapLine) =>
    (line.axis === "x" ? x : y).push(Object.freeze(line));
  for (const layer of sceneLayers(page.nodes)) {
    const node = layer.node,
      scene = node.scene;
    if (!scene || layer.hidden || excluded.has(node.id)) continue;
    const points = [
      { x: 0, y: 0 },
      { x: scene.width, y: 0 },
      { x: 0, y: scene.height },
      { x: scene.width, y: scene.height },
    ].map((point) => transformPoint(point, layer.transform));
    for (const axis of ["x", "y"] as const) {
      const minimum = Math.min(...points.map((point) => point[axis]));
      const maximum = Math.max(...points.map((point) => point[axis]));
      const positions = [minimum, minimum + (maximum - minimum) / 2, maximum];
      positions.forEach((position, index) => {
        if (!Number.isFinite(position))
          throw new CoreError("INVALID_SNAP_INPUT");
        append({
          id: JSON.stringify(["object", node.id, axis, features[index]]),
          axis,
          position,
          kind: "object",
          nodeId: node.id,
        });
      });
    }
  }
  const guides = options.guides === undefined ? [] : options.guides;
  if (!Array.isArray(guides) || guides.length > 1000)
    throw new CoreError("INVALID_SNAP_INPUT");
  const ids = new Set<string>();
  for (const guide of guides) {
    if (
      !guide ||
      typeof guide !== "object" ||
      typeof guide.id !== "string" ||
      !guide.id ||
      guide.id.length > 200 ||
      ids.has(guide.id) ||
      !["x", "y"].includes(guide.axis) ||
      !Number.isFinite(guide.position) ||
      Math.abs(guide.position) > 1e6
    )
      throw new CoreError("INVALID_SNAP_INPUT");
    ids.add(guide.id);
    append({
      id: JSON.stringify(["guide", guide.id, guide.axis]),
      axis: guide.axis,
      position: guide.position,
      kind: "guide",
      guideId: guide.id,
    });
  }
  const order = (a: SnapLine, b: SnapLine) =>
    a.position - b.position || compareIds(a.id, b.id);
  const byId = Object.create(null) as Record<string, SnapLine | undefined>;
  for (const line of [...x, ...y]) byId[line.id] = line;
  return Object.freeze({
    source: gesture,
    x: Object.freeze(x.sort(order)),
    y: Object.freeze(y.sort(order)),
    byId: Object.freeze(byId),
  });
}

function lowerBound(lines: readonly SnapLine[], position: number) {
  let low = 0,
    high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].position < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Correction is always based on raw coordinates, never the last snapped output.
 * The caller passes this pointer to the existing transform solver, which remains
 * the sole producer and validator of document geometry. */
export function solveMoveSnapping(
  gesture: TransformGesture,
  index: SnapIndex,
  rawPointer: Point,
  options: { zoom: number; bypass?: boolean; state?: SnapState },
): { pointer: Point; guides: SnapMatch[]; state: SnapState } {
  if (index.source !== gesture) throw new CoreError("SNAP_SNAPSHOT_MISMATCH");
  const zoom = options.zoom;
  if (
    gesture.tool !== "move" ||
    ![rawPointer.x, rawPointer.y, zoom].every(Number.isFinite) ||
    zoom <= 0 ||
    !Number.isFinite(SNAP_THRESHOLDS.release / zoom)
  )
    throw new CoreError("INVALID_SNAP_INPUT");
  const pointer = { ...rawPointer },
    state: Partial<Record<Axis, { targetId: string; feature: Feature }>> = {},
    guides: SnapMatch[] = [];
  const delta = {
    x: rawPointer.x - gesture.startPointer.x,
    y: rawPointer.y - gesture.startPointer.y,
  };
  if (options.bypass || (delta.x === 0 && delta.y === 0))
    return { pointer, guides, state };
  for (const axis of ["x", "y"] as const) {
    const bounds = gesture.frame.bounds,
      minimum = bounds[axis] + delta[axis],
      length = axis === "x" ? bounds.width : bounds.height;
    const sources = {
      start: minimum,
      center: minimum + length / 2,
      end: minimum + length,
    };
    let chosen:
      { line: SnapLine; feature: Feature; distance: number } | undefined;
    const latch = options.state?.[axis];
    if (latch && features.includes(latch.feature)) {
      const line = index.byId[latch.targetId];
      if (line?.axis === axis) {
        const distance =
          Math.abs(line.position - sources[latch.feature]) * zoom;
        if (distance <= SNAP_THRESHOLDS.release + 1e-9)
          chosen = { line, feature: latch.feature, distance };
      }
    }
    if (!chosen) {
      const threshold = SNAP_THRESHOLDS.enter / zoom;
      for (const feature of features) {
        const source = sources[feature];
        const lines = index[axis];
        // Expand by a tiny screen-space epsilon only for boundary roundoff.
        for (
          let i = lowerBound(lines, source - threshold - 1e-9 / zoom);
          i < lines.length &&
          lines[i].position <= source + threshold + 1e-9 / zoom;
          i++
        ) {
          const line = lines[i],
            distance = Math.abs(line.position - source) * zoom;
          const priority = line.kind === "guide" ? 0 : 1;
          const previous = chosen && (chosen.line.kind === "guide" ? 0 : 1);
          if (
            !chosen ||
            priority < previous! ||
            (priority === previous &&
              (distance < chosen.distance - 1e-9 ||
                (Math.abs(distance - chosen.distance) <= 1e-9 &&
                  (compareIds(line.id, chosen.line.id) < 0 ||
                    (line.id === chosen.line.id &&
                      features.indexOf(feature) <
                        features.indexOf(chosen.feature))))))
          )
            chosen = { line, feature, distance };
        }
      }
    }
    if (chosen) {
      pointer[axis] += chosen.line.position - sources[chosen.feature];
      guides.push({ ...chosen.line, feature: chosen.feature });
      state[axis] = { targetId: chosen.line.id, feature: chosen.feature };
    }
  }
  return { pointer, guides, state };
}
