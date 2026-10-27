import type { PointerEvent } from "react";
import type { TransformFrame } from "../core/affine-geometry";
import type { TransformHandle } from "../core/transform-gesture";
import { transformPoint, type Point, type SceneView } from "../core/scene";
import { useI18n } from "./i18n";
import "./TransformHandles.css";
type HandlePoint = { handle: TransformHandle; point: Point; cursor: string };
export function projectTransformHandles(
  frame: TransformFrame,
  view: SceneView,
):
  | {
      outline: Point[];
      handles: HandlePoint[];
      rotate: Point;
      rotationBase: Point;
    }
  | undefined {
  if (!frame.roots.length || view.zoom <= 0) return;
  const root = frame.roots.length === 1 ? frame.roots[0] : undefined;
  const outline = (
    root
      ? [
          { x: 0, y: 0 },
          { x: root.width, y: 0 },
          { x: root.width, y: root.height },
          { x: 0, y: root.height },
        ].map((p) => transformPoint(p, root.world))
      : [
          { x: frame.bounds.x, y: frame.bounds.y },
          { x: frame.bounds.x + frame.bounds.width, y: frame.bounds.y },
          {
            x: frame.bounds.x + frame.bounds.width,
            y: frame.bounds.y + frame.bounds.height,
          },
          { x: frame.bounds.x, y: frame.bounds.y + frame.bounds.height },
        ]
  ).map((p) => ({
    x: p.x * view.zoom + view.panX,
    y: p.y * view.zoom + view.panY,
  }));
  if (!outline.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    return;
  const midpoint = (a: Point, b: Point) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const center = midpoint(outline[0], outline[2]);
  const names: TransformHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const points = [
    outline[0],
    midpoint(outline[0], outline[1]),
    outline[1],
    midpoint(outline[1], outline[2]),
    outline[2],
    midpoint(outline[2], outline[3]),
    outline[3],
    midpoint(outline[3], outline[0]),
  ];
  const handles = points.map((point, index) => {
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    const direction = ((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4;
    return {
      handle: names[index],
      point,
      cursor: ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][
        direction
      ],
    };
  });
  const rotationBase = points[1],
    length = Math.hypot(rotationBase.x - center.x, rotationBase.y - center.y);
  const direction =
    length > 1e-6
      ? {
          x: (rotationBase.x - center.x) / length,
          y: (rotationBase.y - center.y) / length,
        }
      : { x: 0, y: -1 };
  return {
    outline,
    handles,
    rotationBase,
    rotate: {
      x: rotationBase.x + 28 * direction.x,
      y: rotationBase.y + 28 * direction.y,
    },
  };
}
const handleNames: Record<TransformHandle, string> = {
  nw: "Сверху слева",
  n: "Сверху по центру",
  ne: "Сверху справа",
  e: "Справа по центру",
  se: "Снизу справа",
  s: "Снизу по центру",
  sw: "Снизу слева",
  w: "Слева по центру",
};
export function TransformHandles({
  frame,
  view,
  mode,
  disabled = false,
  onStart,
}: {
  frame: TransformFrame;
  view: SceneView;
  mode: "resize" | "scale";
  disabled?: boolean;
  onStart: (
    event: PointerEvent<HTMLButtonElement>,
    tool: "resize" | "scale" | "rotate",
    handle?: TransformHandle,
  ) => void;
}) {
  const { t } = useI18n();
  const layout = projectTransformHandles(frame, view);
  if (disabled || !layout) return null;
  return (
    <div className="canvas-transform-handles" aria-hidden="true">
      <svg className="canvas-transform-outline" width="100%" height="100%">
        <polygon
          points={layout.outline.map((p) => `${p.x},${p.y}`).join(" ")}
        />
        <line
          x1={layout.rotationBase.x}
          y1={layout.rotationBase.y}
          x2={layout.rotate.x}
          y2={layout.rotate.y}
        />
      </svg>
      {layout.handles.map(({ handle, point, cursor }) => (
        <button
          key={handle}
          type="button"
          tabIndex={-1}
          data-transform-handle={handle}
          className="canvas-transform-handle"
          style={{ left: point.x, top: point.y, cursor }}
          title={t(
            mode === "resize" ? "Изменить размер: {0}" : "Масштабировать: {0}",
            { 0: t(handleNames[handle]) },
          )}
          onPointerDown={(event) => onStart(event, mode, handle)}
        >
          <span />
        </button>
      ))}
      <button
        type="button"
        tabIndex={-1}
        data-transform-handle="rotate"
        className="canvas-transform-handle canvas-transform-rotate"
        style={{ left: layout.rotate.x, top: layout.rotate.y }}
        title={t("Повернуть выделение")}
        onPointerDown={(event) => onStart(event, "rotate")}
      >
        <span />
      </button>
    </div>
  );
}
