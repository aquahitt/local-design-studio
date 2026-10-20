import { CoreError } from "../core/project";
import type { RenderBounds } from "./render";

/** Raster allocation limits apply to output CSS pixels, not world coordinates. */
export const RASTER_LIMITS = { maxSide: 8192, maxPixels: 16_777_216 } as const;

export function captureRectangle(
  bound: Pick<RenderBounds, "x" | "y" | "width" | "height">,
) {
  if (
    ![bound.x, bound.y, bound.width, bound.height].every(Number.isFinite) ||
    bound.width <= 0 ||
    bound.height <= 0
  )
    throw new CoreError("NODE_NOT_VISIBLE");
  const width = Math.ceil(bound.width),
    height = Math.ceil(bound.height);
  if (
    width > RASTER_LIMITS.maxSide ||
    height > RASTER_LIMITS.maxSide ||
    width * height > RASTER_LIMITS.maxPixels
  )
    throw new CoreError(
      "RENDER_RASTER_LIMIT",
      "Capture exceeds 8192 pixels per side or 16777216 output pixels",
    );
  return { x: 0, y: 0, width, height, scale: 1 };
}

/** Native compositors allocate physical pixels before CSS-pixel normalization. */
export function validatePhysicalCapture(
  size: { width: number; height: number },
  pixelRatio: number,
): void {
  const width = Math.ceil(size.width * pixelRatio),
    height = Math.ceil(size.height * pixelRatio);
  if (
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    !Number.isFinite(width * height) ||
    width > 16384 ||
    height > 16384 ||
    width * height > 67_108_864
  )
    throw new CoreError(
      "RENDER_RASTER_LIMIT",
      "Physical capture exceeds 16384 pixels per side or 67108864 pixels",
    );
}

/** Translate the disposable body without changing DOM ancestry or its flow size.
 * A new transform captures viewport-fixed/initial-containing-block positioned
 * descendants. Preserve their resolved insets first; transformed ancestors already
 * supply their own containing block and must remain untouched.
 */
export function translateCaptureExpression(
  bound: Pick<RenderBounds, "x" | "y">,
): string {
  return `(async () => {
    if (!document.getElementById('root')) throw new Error('RENDER_SURFACE_UNAVAILABLE');
    const body = document.body;
    const bodyStyle = getComputedStyle(body);
    const positioned = [...body.querySelectorAll('*')].flatMap(element => {
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      const viewportFixed = style.position === 'fixed' && element.offsetParent === null;
      const initialAbsolute = style.position === 'absolute' && element.offsetParent === body && bodyStyle.position === 'static';
      return viewportFixed || initialAbsolute ? [{element, left:style.left, top:style.top, width:style.width, height:style.height}] : [];
    });
    for (const {element,left,top,width,height} of positioned) {
      Object.assign(element.style, {left,top,width,height,right:'auto',bottom:'auto'});
    }
    body.style.translate = ${JSON.stringify(`${-bound.x}px ${-bound.y}px`)};
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.devicePixelRatio;
  })()`;
}

/** Match screenshot animation semantics: finite effects finish, infinite effects cancel.
 * This renderer is disposable; no running editor animation or document is changed.
 */
export const settleCaptureExpression = `(async () => {
  await document.fonts.ready;
  for (const animation of document.getAnimations()) {
    try {
      const timing = animation.effect?.getComputedTiming();
      if (!timing || !Number.isFinite(timing.endTime)) animation.cancel();
      else { animation.finish(); animation.pause(); }
    } catch { animation.cancel(); }
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`;

export async function withCaptureTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new CoreError("RENDER_TIMEOUT")),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
