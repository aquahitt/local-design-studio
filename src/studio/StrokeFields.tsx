import type { Paint, Stroke } from "../core/paint";
import type { SceneMetadata } from "../core/scene";
import {
  PaintFields,
  legacyPaintColor,
  type PaintFieldsProps,
} from "./PaintFields";
import { Numeric } from "./PaintNumbers";
import { StudioSelect } from "./StudioSelect";
import { useI18n } from "./i18n";

export type StrokeFieldsProps = Omit<
  PaintFieldsProps,
  "mode" | "renderPaintControls"
>;
export function strokePaint(paint: Stroke): Paint {
  const { width: _width, alignment: _alignment, ...value } = paint;
  return value;
}
/** Paint kind changes preserve each row's independent geometry; newly added rows start inside. */
export function restoreStrokeGeometry(
  paints: readonly Paint[],
  previous: readonly Stroke[] = [],
): Stroke[] {
  const old = new Map(previous.map((stroke) => [stroke.id, stroke]));
  return paints.map((paint) => ({
    ...paint,
    width: old.get(paint.id)?.width ?? 1,
    alignment: old.get(paint.id)?.alignment ?? "inside",
  }));
}
export function StrokeFields({
  scene,
  onChange,
  disabled,
  ...props
}: StrokeFieldsProps) {
  const { t } = useI18n();
  const legacy = scene.strokes === undefined && scene.stroke !== undefined;
  const color = legacyPaintColor(scene.stroke);
  const width = scene.strokeWidth ?? 1;
  const convertible =
    !!color && Number.isFinite(width) && width >= 0 && width <= 4096;
  const update = (id: string, patch: Partial<Stroke>) =>
    onChange({
      ...scene,
      strokes: (scene.strokes ?? []).map((stroke) =>
        stroke.id === id ? ({ ...stroke, ...patch } as Stroke) : stroke,
      ),
    });
  const virtual: SceneMetadata = {
    ...scene,
    fill: undefined,
    stroke: undefined,
    strokeWidth: undefined,
    strokes: undefined,
    shadows: undefined,
    fills: (scene.strokes ?? []).map(strokePaint),
  };
  return (
    <>
      {legacy && (
        <section
          className="paint-fields paint-legacy"
          aria-label={t("Обводки фрейма")}
        >
          <h4>{t("Обводки")}</h4>
          <p className="paint-hint">
            {t(
              convertible
                ? "Прежняя обводка сохранена. Преобразуй её для редактирования стека."
                : "Прежнюю обводку нельзя преобразовать точно. Она сохранена; можно явно убрать её и создать новую.",
            )}
          </p>
          <button
            type="button"
            disabled={disabled || !convertible}
            onClick={() => {
              if (color && convertible)
                onChange({
                  ...scene,
                  strokes: [
                    {
                      id: crypto.randomUUID(),
                      kind: "solid",
                      color,
                      width,
                      alignment: "inside",
                    },
                  ],
                });
            }}
          >
            {t("Преобразовать прежнюю обводку")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...scene, strokes: [] })}
          >
            {t("Убрать прежнюю обводку")}
          </button>
        </section>
      )}
      <PaintFields
        {...props}
        scene={virtual}
        mode="strokes"
        disabled={disabled || legacy}
        onChange={(next) =>
          onChange({
            ...scene,
            strokes: restoreStrokeGeometry(next.fills ?? [], scene.strokes),
          })
        }
        paintSize={(paint) => {
          const stroke = scene.strokes?.find(
            (stroke) => stroke.id === paint.id,
          );
          const outset = stroke
            ? stroke.alignment === "outside"
              ? stroke.width
              : stroke.alignment === "center"
                ? stroke.width / 2
                : 0
            : 0;
          return {
            width: scene.width + 2 * outset,
            height: scene.height + 2 * outset,
          };
        }}
        renderPaintControls={(paint, index) => {
          const stroke = scene.strokes?.find(
            (stroke) => stroke.id === paint.id,
          );
          if (!stroke) return null;
          return (
            <div className="paint-numbers stroke-geometry">
              <Numeric
                label={t("Ширина обводки {0}", { 0: index + 1 })}
                value={stroke.width}
                min={0}
                max={4096}
                disabled={disabled}
                onChange={(width) => update(stroke.id, { width })}
              />
              <StudioSelect
                label={t("Выравнивание обводки {0}", { 0: index + 1 })}
                value={stroke.alignment}
                disabled={disabled}
                onChange={(alignment) =>
                  update(stroke.id, {
                    alignment: alignment as Stroke["alignment"],
                  })
                }
                sections={[
                  {
                    label: "",
                    options: [
                      { value: "inside", label: t("Внутри") },
                      { value: "center", label: t("По центру") },
                      { value: "outside", label: t("Снаружи") },
                    ],
                  },
                ]}
              />
            </div>
          );
        }}
      />
    </>
  );
}
