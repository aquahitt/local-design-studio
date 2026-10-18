import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BlendMode, Paint, RGBA, Shadow } from "../core/paint";
import { BLEND_MODES } from "../core/paint";
import type { SceneMetadata } from "../core/scene";
import { StudioSelect } from "./StudioSelect";
import { useI18n } from "./i18n";
import "./PaintFields.css";

const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const black: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const hex = (color: RGBA) =>
  "#" +
  [color.r, color.g, color.b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
function fromHex(value: string, alpha: number): RGBA {
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
    a: alpha,
  };
}
/** Exact conversion for legacy hex and numeric rgb(a); other CSS colors are
 * explicitly replaced rather than silently approximated during editing. */
function legacyColor(value: string | undefined): RGBA | undefined {
  if (!value) return undefined;
  if (value.toLowerCase() === "transparent") return { ...black, a: 0 };
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (match) {
    const full =
      match[1].length < 5 ? [...match[1]].map((v) => v + v).join("") : match[1];
    return {
      ...fromHex(
        "#" + full.slice(0, 6),
        full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1,
      ),
    };
  }
  const rgb =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(
      value,
    );
  if (rgb) {
    const [r, g, b, a] = [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      Number(rgb[4] ?? 1),
    ];
    if ([r, g, b].every((v) => v <= 255) && a >= 0 && a <= 1)
      return { r, g, b, a };
  }
}
function Action({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: "up" | "down" | "remove" | "show" | "hide";
  disabled: boolean;
  onClick: () => void;
}) {
  const paths = {
    up: "m6 14 6-6 6 6",
    down: "m6 10 6 6 6-6",
    remove: "M6 6l12 12M18 6 6 18",
    show: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
    hide: "m3 3 18 18M9 5.5C10 5 11 5 12 5c6 0 10 7 10 7s-1 2-3 4M6 7C3 9 2 12 2 12s4 7 10 7c2 0 3-.5 4-1",
  };
  return (
    <button
      type="button"
      className="paint-action"
      title={label}
      aria-label={label}
      data-paint-action={icon}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={paths[icon]} />
      </svg>
    </button>
  );
}
const PendingNumbers = createContext<(id: string, pending: boolean) => void>(
  () => {},
);
function Numeric({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step = "any",
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: string | number;
}) {
  const id = useId();
  const report = useContext(PendingNumbers);
  const [raw, setRaw] = useState(String(value));
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setRaw(String(value));
    setPending(false);
  }, [value]);
  useEffect(() => {
    report(id, pending);
    return () => report(id, false);
  }, [id, pending, report]);
  return (
    <label>
      {label}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={pending || undefined}
        value={raw}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          const complete = next.trim() !== "" && Number.isFinite(Number(next));
          setPending(!complete);
          if (complete) onChange(Number(next));
        }}
        onBlur={() => {
          if (pending) {
            setRaw(String(value));
            setPending(false);
          }
        }}
      />
    </label>
  );
}
function Color({
  label,
  alphaLabel,
  value,
  onChange,
  disabled,
}: {
  label: string;
  alphaLabel: string;
  value: RGBA;
  onChange: (next: RGBA) => void;
  disabled: boolean;
}) {
  return (
    <div className="paint-color">
      <label>
        {label}
        <input
          type="color"
          aria-label={label}
          value={hex(value)}
          disabled={disabled}
          onChange={(e) => onChange(fromHex(e.target.value, value.a))}
        />
      </label>
      <Numeric
        label={alphaLabel}
        value={value.a}
        min={0}
        max={1}
        step={0.01}
        disabled={disabled}
        onChange={(a) => onChange({ ...value, a })}
      />
    </div>
  );
}
function reorder<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items];
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  return next;
}
function changeKind(paint: Paint, kind: Paint["kind"]): Paint {
  const { id, enabled, opacity, blendMode } = paint;
  const common = {
    id,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(blendMode ? { blendMode } : {}),
  };
  const color = paint.kind === "solid" ? paint.color : paint.stops[0].color;
  const stops =
    paint.kind === "solid"
      ? [
          { offset: 0, color },
          { offset: 1, color: white },
        ]
      : paint.stops;
  if (kind === "solid") return { ...common, kind, color };
  if (kind === "linear") return { ...common, kind, angle: 90, stops };
  return {
    ...common,
    kind,
    center: { x: 0.5, y: 0.5 },
    radius: { x: 0.5, y: 0.5 },
    stops,
  };
}

/** Rendering guard only. Canonical validateFramePaint still rejects invalid bounds,
 * order, unknown fields and counts. Safe numeric drafts stay visible for correction. */
export function isRenderableFramePaintDraft(
  value: unknown,
): value is SceneMetadata {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const rgba = (v: unknown) =>
    object(v) && ["r", "g", "b", "a"].every((k) => numeric(v[k]));
  const pair = (v: unknown) => object(v) && numeric(v.x) && numeric(v.y);
  if (
    !object(value) ||
    value.kind !== "frame" ||
    (value.fill !== undefined && typeof value.fill !== "string")
  )
    return false;
  if (
    value.fills !== undefined &&
    (!Array.isArray(value.fills) ||
      !value.fills.every((p) => {
        if (
          !object(p) ||
          typeof p.id !== "string" ||
          (p.opacity !== undefined && !numeric(p.opacity))
        )
          return false;
        if (p.kind === "solid") return rgba(p.color);
        if (p.kind !== "linear" && p.kind !== "radial") return false;
        return (
          Array.isArray(p.stops) &&
          p.stops.length > 0 &&
          p.stops.every(
            (stop) => object(stop) && numeric(stop.offset) && rgba(stop.color),
          ) &&
          (p.kind === "linear"
            ? numeric(p.angle)
            : pair(p.center) && pair(p.radius))
        );
      }))
  )
    return false;
  return (
    value.shadows === undefined ||
    (Array.isArray(value.shadows) &&
      value.shadows.every(
        (shadow) =>
          object(shadow) &&
          typeof shadow.id === "string" &&
          typeof shadow.kind === "string" &&
          ["inner", "outer"].includes(shadow.kind) &&
          ["x", "y", "blur", "spread"].every((k) => numeric(shadow[k])) &&
          rgba(shadow.color),
      ))
  );
}

/** Controlled fields only: NodeLayoutInspector owns the single revisioned draft. */
export function PaintFields({
  scene,
  disabled,
  onChange,
  onPendingChange,
}: {
  scene: SceneMetadata;
  disabled: boolean;
  onChange: (next: SceneMetadata) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [pendingInputs, setPendingInputs] = useState<Set<string>>(
    () => new Set(),
  );
  const [report] = useState(
    () => (id: string, pending: boolean) =>
      setPendingInputs((current) => {
        if (current.has(id) === pending) return current;
        const next = new Set(current);
        if (pending) next.add(id);
        else next.delete(id);
        return next;
      }),
  );
  useEffect(() => {
    onPendingChange(pendingInputs.size > 0);
  }, [pendingInputs, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  const fills = scene.fills ?? [];
  const shadows = scene.shadows ?? [];
  const legacy = legacyColor(scene.fill);
  const setFills = (next: Paint[]) => onChange({ ...scene, fills: next });
  const setShadows = (next: Shadow[]) => onChange({ ...scene, shadows: next });
  const updateFill = (index: number, next: Paint) =>
    setFills(fills.map((paint, i) => (i === index ? next : paint)));
  const updateShadow = (index: number, next: Shadow) =>
    setShadows(shadows.map((shadow, i) => (i === index ? next : shadow)));
  const kindLabels = {
    solid: t("Сплошная"),
    linear: t("Линейный градиент"),
    radial: t("Радиальный градиент"),
  };
  const blendLabels: Record<BlendMode, string> = {
    normal: t("Обычный"),
    multiply: t("Умножение"),
    screen: t("Экран"),
    overlay: t("Перекрытие"),
    darken: t("Затемнение"),
    lighten: t("Осветление"),
    "color-dodge": t("Осветление основы"),
    "color-burn": t("Затемнение основы"),
    "hard-light": t("Жёсткий свет"),
    "soft-light": t("Мягкий свет"),
    difference: t("Разница"),
    exclusion: t("Исключение"),
    hue: t("Цветовой тон"),
    saturation: t("Насыщенность"),
    color: t("Цветность"),
    luminosity: t("Яркость"),
  };
  const shadowNumbers = {
    x: t("X тени {0}"),
    y: t("Y тени {0}"),
    blur: t("Размытие тени {0}"),
    spread: t("Расширение тени {0}"),
  };
  const fillLabel = (key: string, index: number) => t(key, { 0: index + 1 });
  function listActions<T extends { enabled?: boolean }>(
    items: T[],
    index: number,
    save: (items: T[]) => void,
    labels: [string, string, string, string, string],
    list: "fill" | "shadow",
  ): ReactNode {
    const item = items[index];
    return (
      <div className="paint-list-actions">
        <Action
          label={fillLabel(
            item.enabled === false ? labels[0] : labels[1],
            index,
          )}
          icon={item.enabled === false ? "hide" : "show"}
          disabled={disabled}
          onClick={() =>
            save(
              items.map((value, i) =>
                i === index
                  ? { ...value, enabled: value.enabled === false }
                  : value,
              ),
            )
          }
        />
        <Action
          label={fillLabel(labels[2], index)}
          icon="up"
          disabled={disabled || index === 0}
          onClick={() => save(reorder(items, index, -1))}
        />
        <Action
          label={fillLabel(labels[3], index)}
          icon="down"
          disabled={disabled || index === items.length - 1}
          onClick={() => save(reorder(items, index, 1))}
        />
        <Action
          label={fillLabel(labels[4], index)}
          icon="remove"
          disabled={disabled}
          onClick={() => {
            save(items.filter((_, i) => i !== index));
            requestAnimationFrame(() => {
              const rows = root.current?.querySelectorAll<HTMLElement>(
                `fieldset[data-paint-list="${list}"]`,
              );
              const row = rows?.[Math.min(index, rows.length - 1)];
              const target =
                row?.querySelector<HTMLButtonElement>(
                  '.paint-list-actions button[data-paint-action="remove"]',
                ) ??
                root.current?.querySelector<HTMLButtonElement>(
                  `button[data-paint-add="${list}"]`,
                );
              target?.focus();
            });
          }}
        />
      </div>
    );
  }
  return (
    <PendingNumbers.Provider value={report}>
      <div
        ref={root}
        className="paint-fields"
        role="group"
        aria-label={t("Заливки и тени фрейма")}
      >
        <h4>{t("Заливки")}</h4>
        <p className="paint-hint">
          {t(
            "Верхняя строка — верхняя заливка. Значения альфа и непрозрачности: 0–1.",
          )}
        </p>
        {scene.fills === undefined && scene.fill && (
          <div className="paint-legacy">
            <p>
              {legacy
                ? t("Прежний цвет будет сохранён в первой заливке.")
                : t(
                    "Прежний цвет {0} не преобразуется точно. Новый набор заменит его после применения.",
                    { 0: scene.fill },
                  )}
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                setFills([
                  {
                    id: crypto.randomUUID(),
                    kind: "solid",
                    color: legacy ?? white,
                  },
                ])
              }
            >
              {legacy
                ? t("Редактировать заливки")
                : t("Заменить прежнюю заливку")}
            </button>
          </div>
        )}
        {fills.map((paint, index) => (
          <fieldset
            key={paint.id}
            className="paint-row"
            data-paint-list="fill"
            data-paint-id={paint.id}
          >
            <legend>{t("Заливка {0}", { 0: index + 1 })}</legend>
            {listActions(
              fills,
              index,
              setFills,
              [
                t("Показать заливку {0}"),
                t("Скрыть заливку {0}"),
                t("Поднять заливку {0}"),
                t("Опустить заливку {0}"),
                t("Удалить заливку {0}"),
              ],
              "fill",
            )}
            <StudioSelect
              label={t("Тип заливки {0}", { 0: index + 1 })}
              value={paint.kind}
              disabled={disabled}
              onChange={(kind) =>
                updateFill(index, changeKind(paint, kind as Paint["kind"]))
              }
              sections={[
                {
                  label: "",
                  options: Object.entries(kindLabels).map(([value, label]) => ({
                    value,
                    label,
                  })),
                },
              ]}
            />
            <div className="paint-numbers">
              <Numeric
                label={t("Непрозрачность заливки {0}", { 0: index + 1 })}
                disabled={disabled}
                min={0}
                max={1}
                step={0.01}
                value={paint.opacity ?? 1}
                onChange={(opacity) => updateFill(index, { ...paint, opacity })}
              />
              <label>
                {t("Смешивание заливки {0}", { 0: index + 1 })}
                <StudioSelect
                  label={t("Смешивание заливки {0}", { 0: index + 1 })}
                  value={paint.blendMode ?? "normal"}
                  disabled={disabled}
                  onChange={(blendMode) =>
                    updateFill(index, {
                      ...paint,
                      blendMode: blendMode as BlendMode,
                    })
                  }
                  sections={[
                    {
                      label: "",
                      options: BLEND_MODES.map((value) => ({
                        value,
                        label: blendLabels[value],
                      })),
                    },
                  ]}
                />
              </label>
            </div>
            {paint.kind === "solid" ? (
              <Color
                label={t("Цвет заливки {0}", { 0: index + 1 })}
                alphaLabel={t("Альфа заливки {0}", { 0: index + 1 })}
                value={paint.color}
                disabled={disabled}
                onChange={(color) => updateFill(index, { ...paint, color })}
              />
            ) : (
              <>
                {paint.kind === "linear" ? (
                  <Numeric
                    label={t("Угол заливки {0}", { 0: index + 1 })}
                    value={paint.angle}
                    disabled={disabled}
                    onChange={(angle) => updateFill(index, { ...paint, angle })}
                  />
                ) : (
                  <div className="paint-numbers">
                    {(["center", "radius"] as const).flatMap((field) =>
                      (["x", "y"] as const).map((axis) => (
                        <Numeric
                          key={field + axis}
                          label={t(
                            field === "center"
                              ? axis === "x"
                                ? "Центр X заливки {0}"
                                : "Центр Y заливки {0}"
                              : axis === "x"
                                ? "Радиус X заливки {0}"
                                : "Радиус Y заливки {0}",
                            { 0: index + 1 },
                          )}
                          disabled={disabled}
                          min={field === "radius" ? 0.001 : 0}
                          max={field === "radius" ? 4 : 1}
                          value={paint[field][axis]}
                          onChange={(value) =>
                            updateFill(index, {
                              ...paint,
                              [field]: { ...paint[field], [axis]: value },
                            })
                          }
                        />
                      )),
                    )}
                  </div>
                )}
                <p className="paint-hint">
                  {t(
                    "Точки идут по порядку, позиция: 0–1. Одинаковые позиции создают резкий переход.",
                  )}
                </p>
                {paint.stops.map((stop, stopIndex) => (
                  <div
                    key={stopIndex}
                    className="paint-stop"
                    role="group"
                    aria-label={t("Точка {0} заливки {1}", {
                      0: stopIndex + 1,
                      1: index + 1,
                    })}
                  >
                    <Numeric
                      label={t("Позиция точки {0} заливки {1}", {
                        0: stopIndex + 1,
                        1: index + 1,
                      })}
                      value={stop.offset}
                      disabled={disabled}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(offset) =>
                        updateFill(index, {
                          ...paint,
                          stops: paint.stops.map((value, i) =>
                            i === stopIndex ? { ...value, offset } : value,
                          ),
                        })
                      }
                    />
                    <Color
                      label={t("Цвет точки {0} заливки {1}", {
                        0: stopIndex + 1,
                        1: index + 1,
                      })}
                      alphaLabel={t("Альфа точки {0} заливки {1}", {
                        0: stopIndex + 1,
                        1: index + 1,
                      })}
                      disabled={disabled}
                      value={stop.color}
                      onChange={(color) =>
                        updateFill(index, {
                          ...paint,
                          stops: paint.stops.map((value, i) =>
                            i === stopIndex ? { ...value, color } : value,
                          ),
                        })
                      }
                    />
                    <Action
                      icon="remove"
                      label={t("Удалить точку {0} заливки {1}", {
                        0: stopIndex + 1,
                        1: index + 1,
                      })}
                      disabled={disabled || paint.stops.length <= 2}
                      onClick={() => {
                        updateFill(index, {
                          ...paint,
                          stops: paint.stops.filter((_, i) => i !== stopIndex),
                        });
                        requestAnimationFrame(() => {
                          const row = [
                            ...(root.current?.querySelectorAll<HTMLElement>(
                              "[data-paint-id]",
                            ) ?? []),
                          ].find((el) => el.dataset.paintId === paint.id);
                          row
                            ?.querySelector<HTMLButtonElement>(
                              "[data-stop-add]",
                            )
                            ?.focus();
                        });
                      }}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  data-stop-add="true"
                  disabled={disabled || paint.stops.length >= 64}
                  onClick={() =>
                    updateFill(index, {
                      ...paint,
                      stops: [
                        ...paint.stops,
                        { offset: 1, color: paint.stops.at(-1)!.color },
                      ],
                    })
                  }
                >
                  {t("Добавить точку заливки {0}", { 0: index + 1 })}
                </button>
              </>
            )}
          </fieldset>
        ))}
        {(scene.fills !== undefined || !scene.fill) && (
          <button
            type="button"
            data-paint-add="fill"
            disabled={disabled || fills.length >= 16}
            onClick={() =>
              setFills([
                { id: crypto.randomUUID(), kind: "solid", color: white },
                ...fills,
              ])
            }
          >
            {t("Добавить заливку")}
          </button>
        )}
        {scene.fills !== undefined && fills.length === 0 && (
          <p className="paint-hint">
            {t("Фон прозрачен. Прежняя заливка не используется.")}
          </p>
        )}
        <h4>{t("Тени")}</h4>
        {shadows.map((shadow, index) => (
          <fieldset
            key={shadow.id}
            className="paint-row"
            data-paint-list="shadow"
          >
            <legend>{t("Тень {0}", { 0: index + 1 })}</legend>
            {listActions(
              shadows,
              index,
              setShadows,
              [
                t("Показать тень {0}"),
                t("Скрыть тень {0}"),
                t("Поднять тень {0}"),
                t("Опустить тень {0}"),
                t("Удалить тень {0}"),
              ],
              "shadow",
            )}
            <StudioSelect
              label={t("Тип тени {0}", { 0: index + 1 })}
              value={shadow.kind}
              disabled={disabled}
              onChange={(kind) =>
                updateShadow(index, { ...shadow, kind: kind as Shadow["kind"] })
              }
              sections={[
                {
                  label: "",
                  options: [
                    { value: "outer", label: t("Внешняя") },
                    { value: "inner", label: t("Внутренняя") },
                  ],
                },
              ]}
            />
            <div className="paint-numbers">
              {(["x", "y", "blur", "spread"] as const).map((field) => (
                <Numeric
                  key={field}
                  label={t(shadowNumbers[field], { 0: index + 1 })}
                  disabled={disabled}
                  value={shadow[field]}
                  min={field === "blur" ? 0 : -4096}
                  max={4096}
                  onChange={(value) =>
                    updateShadow(index, { ...shadow, [field]: value })
                  }
                />
              ))}
            </div>
            <Color
              label={t("Цвет тени {0}", { 0: index + 1 })}
              alphaLabel={t("Альфа тени {0}", { 0: index + 1 })}
              disabled={disabled}
              value={shadow.color}
              onChange={(color) => updateShadow(index, { ...shadow, color })}
            />
          </fieldset>
        ))}
        <button
          type="button"
          data-paint-add="shadow"
          disabled={disabled || shadows.length >= 8}
          onClick={() =>
            setShadows([
              ...shadows,
              {
                id: crypto.randomUUID(),
                kind: "outer",
                x: 0,
                y: 4,
                blur: 8,
                spread: 0,
                color: { ...black, a: 0.25 },
              },
            ])
          }
        >
          {t("Добавить тень")}
        </button>
        <p className="paint-hint">
          {t(
            "Заливки и тени пока доступны для фреймов. Изображения, маски и несколько обводок ещё не поддерживаются.",
          )}
        </p>
      </div>
    </PendingNumbers.Provider>
  );
}
