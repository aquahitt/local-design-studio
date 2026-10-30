import type { SnapMatch } from "../core/snapping";
import type { SceneView } from "../core/scene";
/** Editor-only screen-pixel lines; never enter preview, node bounds or export. */
export function SnapOverlay({
  view,
  lines,
}: {
  view: SceneView;
  lines: readonly SnapMatch[];
}) {
  return (
    <div className="canvas-snap-overlay" aria-hidden="true">
      {lines.map((line) => {
        const position =
          line.position * view.zoom +
          (line.axis === "x" ? view.panX : view.panY);
        if (!Number.isFinite(position)) return null;
        return (
          <div
            key={line.id}
            className={`canvas-snap-line axis-${line.axis}`}
            data-snap-axis={line.axis}
            data-snap-position={line.position}
            style={line.axis === "x" ? { left: position } : { top: position }}
          />
        );
      })}
    </div>
  );
}
