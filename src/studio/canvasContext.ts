import type { SceneView } from "../core/scene";
import type { CanvasBounds } from "./canvasCamera";
export type CanvasContext = {
  projectId: string;
  pageId: string;
  revision: number | null;
  transient: boolean;
  view: SceneView;
  bounds: CanvasBounds[];
  width: number;
  height: number;
};
/** Editor measurements are advisory; only an idle, matching revision is canonical. */
export function canonicalCanvasBounds(
  context: CanvasContext | null,
  revision: number,
): CanvasBounds[] {
  return context && !context.transient && context.revision === revision
    ? context.bounds
    : [];
}
export function measuredCanvasContext(
  input: CanvasContext & { epoch: number; measuredEpoch: number | null },
): CanvasContext {
  const { epoch, measuredEpoch, ...context } = input;
  if (context.transient || epoch !== measuredEpoch)
    return { ...context, bounds: [], revision: null };
  return context;
}
export function canvasContextIdentity(
  context: CanvasContext,
  projectId: string,
  pageId: string,
): boolean {
  return context.projectId === projectId && context.pageId === pageId;
}
/** One active write plus one latest replacement: older requests cannot overtake newer status. */
export function createLatestPublisher<T>(
  write: (value: T) => Promise<unknown>,
) {
  let active = false;
  let pending: { value: T } | undefined;
  async function drain() {
    active = true;
    while (pending) {
      const next = pending;
      pending = undefined;
      try {
        await write(next.value);
      } catch {
        /* advisory context retries on the next publication */
      }
    }
    active = false;
  }
  return {
    publish(value: T) {
      pending = { value };
      if (!active) void drain();
    },
  };
}
