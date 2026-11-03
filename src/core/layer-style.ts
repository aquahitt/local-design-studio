import type { ProjectNode } from "./project";
import { compileFramePaint, hasLayeredFramePaint } from "./paint";
import { frameContentClipStyle } from "./frame-paint";

export function layerStyle(node: ProjectNode): Record<string, string | number> {
  const s = node.scene;
  if (!s)
    return {
      position: "relative",
      padding: 8,
      outline: "1px dashed #ddd",
      borderRadius: 6,
      marginBottom: 12,
    };
  const paintStyle = compileFramePaint(s);
  const strokeShadow =
    s.stroke &&
    s.strokes === undefined &&
    s.kind !== "vector" &&
    !hasLayeredFramePaint(s)
      ? `inset 0 0 0 ${s.strokeWidth ?? 1}px ${s.stroke}`
      : undefined;
  return Object.fromEntries(
    Object.entries({
      position: "absolute",
      padding: 0,
      left: s.x,
      top: s.y,
      width: s.width,
      height: s.height,
      transform: s.linearTransform
        ? `matrix(${s.linearTransform.join(", ")}, 0, 0)`
        : `rotate(${s.rotation ?? 0}deg)`,
      transformOrigin: "0 0",
      opacity: s.opacity ?? 1,
      overflow: s.clip && !frameContentClipStyle(s) ? "hidden" : "visible",
      isolation:
        s.kind === "frame" && s.strokes !== undefined ? "isolate" : undefined,
      background:
        s.kind === "text" || s.kind === "vector" || s.fills !== undefined
          ? undefined
          : s.fill,
      color: s.kind === "text" ? s.fill : undefined,
      ...paintStyle,
      boxShadow:
        [strokeShadow, paintStyle.boxShadow].filter(Boolean).join(", ") ||
        undefined,
      borderRadius: s.radius ?? 0,
      boxSizing: "border-box",
    }).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number>;
}
