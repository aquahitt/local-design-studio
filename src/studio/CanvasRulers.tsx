import type { CSSProperties, PointerEvent } from "react";
import type { SceneView } from "../core/scene";
import { useI18n } from "./i18n";
import {
  buildRulerTicks,
  RULER_THICKNESS,
  type RulerTick,
} from "./rulerGeometry";
import "./CanvasRulers.css";
export type CanvasRulersProps = {
  view: SceneView;
  size: { width: number; height: number };
  disabled?: boolean;
  onGuideCreateStart: (
    event: PointerEvent<HTMLButtonElement>,
    axis: "x" | "y",
  ) => void;
  /** Keyboard/assistive technology alternative: open the precise guide coordinate control. */
  onGuideCreate: (axis: "x" | "y") => void;
  onManageGuides: () => void;
};
function TickMarks({
  ticks,
  vertical,
}: {
  ticks: RulerTick[];
  vertical: boolean;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <g
          key={tick.value}
          className={tick.major ? "canvas-ruler-major" : "canvas-ruler-minor"}
        >
          <line
            x1={vertical ? (tick.major ? 16 : 20) : tick.position}
            y1={vertical ? tick.position : tick.major ? 16 : 20}
            x2={vertical ? RULER_THICKNESS : tick.position}
            y2={vertical ? tick.position : RULER_THICKNESS}
            vectorEffect="non-scaling-stroke"
          />
          {tick.major &&
            (vertical ? (
              <text
                transform={`translate(10 ${tick.position - 3}) rotate(-90)`}
              >
                {tick.label}
              </text>
            ) : (
              <text x={tick.position + 3} y={11}>
                {tick.label}
              </text>
            ))}
        </g>
      ))}
    </>
  );
}
/** Editor overlay only: coordinates remain relative to the full unpadded surface. */
export function CanvasRulers({
  view,
  size,
  disabled = false,
  onGuideCreateStart,
  onGuideCreate,
  onManageGuides,
}: CanvasRulersProps) {
  const { t } = useI18n();
  if (
    ![size.width, size.height].every(Number.isFinite) ||
    size.width <= RULER_THICKNESS ||
    size.height <= RULER_THICKNESS
  )
    return null;
  const horizontal = buildRulerTicks({
    zoom: view.zoom,
    pan: view.panX,
    length: size.width,
    start: RULER_THICKNESS,
  });
  const vertical = buildRulerTicks({
    zoom: view.zoom,
    pan: view.panY,
    length: size.height,
    start: RULER_THICKNESS,
  });
  const hint = t(
    "Перетащи направляющую с линейки. Enter или пробел — точная координата.",
  );
  const events = (axis: "x" | "y") => ({
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (!disabled && event.button === 0) onGuideCreateStart(event, axis);
    },
    onClick(event: import("react").MouseEvent<HTMLButtonElement>) {
      event.stopPropagation();
      // Native Enter/Space and AT activation generate detail=0. Pointer creation
      // belongs to the captured drag lifecycle, so its later click cannot duplicate it.
      if (!disabled && event.detail === 0) onGuideCreate(axis);
    },
  });
  return (
    <div
      className="canvas-rulers"
      style={{ "--canvas-ruler-size": `${RULER_THICKNESS}px` } as CSSProperties}
    >
      <button
        type="button"
        className="canvas-ruler-axis canvas-ruler-top"
        aria-label={t("Горизонтальная линейка")}
        title={hint}
        disabled={disabled}
        {...events("y")}
      >
        <svg
          width={size.width}
          height={RULER_THICKNESS}
          viewBox={`0 0 ${size.width} ${RULER_THICKNESS}`}
          aria-hidden="true"
          focusable="false"
        >
          <TickMarks ticks={horizontal} vertical={false} />
        </svg>
      </button>
      <button
        type="button"
        className="canvas-ruler-axis canvas-ruler-left"
        aria-label={t("Вертикальная линейка")}
        title={hint}
        disabled={disabled}
        {...events("x")}
      >
        <svg
          width={RULER_THICKNESS}
          height={size.height}
          viewBox={`0 0 ${RULER_THICKNESS} ${size.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <TickMarks ticks={vertical} vertical />
        </svg>
      </button>
      <button
        type="button"
        className="canvas-ruler-corner"
        aria-label={t("Управление направляющими")}
        title={t("Управление направляющими")}
        disabled={disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) onManageGuides();
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4 4h16v16H4zM4 9h5V4M4 14h3M4 19h5M14 4v3M19 4v5" />
        </svg>
      </button>
    </div>
  );
}
