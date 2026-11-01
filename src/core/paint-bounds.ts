import { paintContributes } from "./paint";
import { transformPoint, type Matrix, type SceneMetadata } from "./scene";

/** Continuous CSS-pixel rectangle; no raster rounding or allocation is implied. */
export type PaintBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type PaintOutsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type FrameBoundsScene = Pick<
  SceneMetadata,
  "kind" | "width" | "height" | "opacity" | "strokes" | "shadows"
>;

function layoutBounds(scene: FrameBoundsScene): PaintBounds {
  return { x: 0, y: 0, width: scene.width, height: scene.height };
}

/**
 * Exact geometric outward extent of the frame's known strokes. Inside and legacy
 * inset strokes do not expand the layout box. Stacks overlap; widths do not add.
 * Transparent/disabled paint contributes nothing. Unknown image alpha is retained.
 * Inputs must already satisfy the scene contract; this helper does not validate.
 */
export function frameStrokeOutsets(scene: FrameBoundsScene): PaintOutsets {
  let outset = 0;
  if (scene.kind === "frame" && scene.opacity !== 0) {
    for (const stroke of scene.strokes ?? []) {
      if (!paintContributes(stroke)) continue;
      const extent =
        stroke.alignment === "outside"
          ? stroke.width
          : stroke.alignment === "center"
            ? stroke.width / 2
            : 0;
      outset = Math.max(outset, extent);
    }
  }
  return { top: outset, right: outset, bottom: outset, left: outset };
}

/**
 * Union of layout and this frame's stroke geometry, in its own local coordinates.
 * It is not an alpha-tight bound. Even fully transparent scenes retain layout.
 * It excludes shadows, descendants, clipping, React content and external portals.
 */
export function frameStrokeLocalBounds(scene: FrameBoundsScene): PaintBounds {
  const { top, right, bottom, left } = frameStrokeOutsets(scene);
  return {
    x: left === 0 ? 0 : -left,
    y: top === 0 ? 0 : -top,
    width: scene.width + left + right,
    height: scene.height + top + bottom,
  };
}

export type FrameShadowBounds = {
  bounds: PaintBounds;
  status: "exact-unblurred" | "conservative-raster";
  policy: "css-raster-envelope-6sigma-plus-2px";
};

/**
 * Layout union this frame's own known outer CSS box-shadow envelopes. CSS shadows
 * originate at the layout border box, independently of outside/center strokes.
 * Negative spread erodes that source before blur; an empty source contributes
 * nothing. Inner/disabled/transparent shadows never enlarge the result.
 *
 * Finite capture policy for 8-bit Chromium raster output: for positive CSS blur,
 * radius = ceil(3 * blur) + 2 local CSS px (6 sigma with sigma = blur/2, plus a
 * raster margin). `conservative-raster` names this capture policy, not an exact
 * alpha bound or a universal browser guarantee: a mathematical Gaussian has
 * infinite support. Service/native pixel QA must verify the policy before crop
 * integration, and consumers must preserve status/policy metadata.
 *
 * `exact-unblurred` describes the continuous rectangular envelope without blur;
 * it does not claim exact nontransparent pixels for rounded corners/occlusion.
 * Descendants, child clipping and arbitrary React/portal effects are excluded.
 * No DOM measurement, raster rounding, finite-output check or allocation occurs.
 */
export function frameShadowLocalBounds(
  scene: FrameBoundsScene,
): FrameShadowBounds {
  let x = 0,
    y = 0,
    right = scene.width,
    bottom = scene.height;
  let status: FrameShadowBounds["status"] = "exact-unblurred";
  if (scene.kind === "frame" && scene.opacity !== 0) {
    for (const shadow of scene.shadows ?? []) {
      if (
        shadow.enabled === false ||
        shadow.kind !== "outer" ||
        shadow.color.a === 0
      )
        continue;
      if (
        scene.width + 2 * shadow.spread <= 0 ||
        scene.height + 2 * shadow.spread <= 0
      )
        continue;
      const radius = shadow.blur > 0 ? Math.ceil(3 * shadow.blur) + 2 : 0;
      if (shadow.blur > 0) status = "conservative-raster";
      const extent = shadow.spread + radius;
      x = Math.min(x, shadow.x - extent);
      y = Math.min(y, shadow.y - extent);
      right = Math.max(right, scene.width + shadow.x + extent);
      bottom = Math.max(bottom, scene.height + shadow.y + extent);
    }
  }
  return {
    bounds: { x, y, width: right - x, height: bottom - y },
    status,
    policy: "css-raster-envelope-6sigma-plus-2px",
  };
}

/**
 * AABB of all four corners under the shared affine transform convention. This
 * projects the supplied envelope, not painted pixels. Reflection, shear and
 * rotation are supported. The caller owns representability and raster limits.
 */
export function projectPaintBounds(
  bounds: PaintBounds,
  matrix: Matrix,
): PaintBounds {
  const right = bounds.x + bounds.width,
    bottom = bounds.y + bounds.height;
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: right, y: bounds.y },
    { x: right, y: bottom },
    { x: bounds.x, y: bottom },
  ].map((point) => transformPoint(point, matrix));
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}
