import { useI18n } from "./i18n";
import { useEffect, useState } from "react";
import {
  parseViewport,
  contentViewport,
  type Viewport,
  type SafeArea,
} from "../core/viewport";
import { DEVICE_PRESETS, presetViewport } from "./devicePresets";
import type { ProjectGroup } from "../core/project";
import { StudioSelect } from "./StudioSelect";
import { StudioButton } from "./DesignSystem";
function draft(viewport: Viewport, revision: number) {
  return {
    width: String(viewport.width),
    height: String(viewport.height ?? 850),
    safeArea: viewport.device?.safeArea ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    cutout: viewport.device?.cutout ?? "none",
    baseRevision: revision,
  };
}
export function ViewportControls({
  viewport,
  revision,
  disabled,
  onApply,
  onDirty,
  shade,
  onShadeChange,
  groups,
  pageId,
  pageCount,
  onBulkApply,
}: {
  groups: ProjectGroup[];
  pageId: string;
  pageCount: number;
  onBulkApply: (
    value: Viewport,
    baseRevision: number,
    groupId?: string,
  ) => Promise<{ count: number; includesCurrent: boolean }>;
  viewport: Viewport;
  revision: number;
  disabled: boolean;
  onApply: (value: Viewport, baseRevision: number) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  shade: boolean;
  onShadeChange: (value: boolean) => void;
}) {
  const { t } = useI18n();

  const [targetGroup, setTargetGroup] = useState(
    () => groups.find((group) => group.pages.includes(pageId))?.id ?? "",
  );
  const [bulkStatus, setBulkStatus] = useState("");
  const selectedGroup = groups.find((group) => group.id === targetGroup);
  const [values, setValues] = useState(() => draft(viewport, revision));
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const signature = JSON.stringify(viewport);
  useEffect(() => {
    if (!editing) setValues(draft(viewport, revision));
  }, [signature, revision, editing]);
  useEffect(() => {
    onDirty(editing);
    return () => onDirty(false);
  }, [editing, onDirty]);
  async function apply(value: Viewport, baseRevision = revision) {
    setBusy(true);
    setError("");
    setBulkStatus("");
    try {
      await onApply(parseViewport(value), baseRevision);
      setEditing(false);
    } catch (e) {
      setError(
        (e as Error).message === "INVALID_VIEWPORT"
          ? t(
              "Размеры: ширина 320–3840, высота 240–3840, зоны 0–240 px; рабочая область не меньше 120 × 120.",
            )
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  function currentValue(): Viewport {
    return editing
      ? {
          width: Number(values.width),
          height: Number(values.height),
          device: {
            preset: "custom",
            orientation:
              Number(values.width) > Number(values.height)
                ? "landscape"
                : "portrait",
            cutout: values.cutout,
            safeArea: values.safeArea,
          },
        }
      : { ...viewport, height: viewport.height ?? 850 };
  }
  async function bulk(groupId?: string) {
    setBusy(true);
    setError("");
    setBulkStatus("");
    try {
      const result = await onBulkApply(
        parseViewport(currentValue()),
        editing ? values.baseRevision : revision,
        groupId,
      );
      if (result.includesCurrent) setEditing(false);
      setBulkStatus(
        t("Применено к {0} экранам.", { 0: result.count }) +
          (editing && !result.includesCurrent
            ? t(" Ввод текущего экрана сохранён в черновике.")
            : ""),
      );
    } catch (error) {
      setError(
        (error as Error).message === "INVALID_VIEWPORT"
          ? t(
              "Проверь размеры и системные зоны: рабочая область должна быть не меньше 120 × 120 px.",
            )
          : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  const size = contentViewport(viewport);
  const preset = DEVICE_PRESETS.find((p) => p.id === viewport.device?.preset);
  return (
    <div className="viewport-controls">
      <div className="viewport-presets">
        <label>
          {t("Устройство")}
          <select
            aria-label={t("Тип устройства")}
            value={preset?.id ?? "custom"}
            disabled={disabled || busy || editing}
            onChange={(e) => {
              const selected = DEVICE_PRESETS.find(
                (p) => p.id === e.target.value,
              );
              if (selected) void apply(presetViewport(selected));
              else
                void apply({
                  width: viewport.width,
                  height: viewport.height ?? 850,
                });
            }}
          >
            <option value="custom">{t("Свои размеры")}</option>
            {[...new Set(DEVICE_PRESETS.map((p) => p.group))].map((group) => (
              <optgroup label={group} key={group}>
                {DEVICE_PRESETS.filter((p) => p.group === group).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <StudioButton
          disabled={disabled || busy || editing}
          onClick={() => {
            if (preset)
              void apply(
                presetViewport(
                  preset,
                  viewport.width === preset.width &&
                    viewport.height === preset.height,
                ),
              );
            else
              void apply({
                width: viewport.height ?? 850,
                height: viewport.width,
                ...(viewport.device
                  ? {
                      device: {
                        ...viewport.device,
                        preset: "custom",
                        orientation:
                          viewport.device.orientation === "portrait"
                            ? "landscape"
                            : "portrait",
                        safeArea: {
                          top: viewport.device.safeArea.left,
                          right: viewport.device.safeArea.top,
                          bottom: viewport.device.safeArea.right,
                          left: viewport.device.safeArea.bottom,
                        },
                      },
                    }
                  : {}),
              });
          }}
        >
          {t("Повернуть устройство")}
        </StudioButton>
        <label className="shade-toggle">
          <input
            type="checkbox"
            aria-label={t("Шторка уведомлений")}
            checked={shade}
            onChange={(e) => onShadeChange(e.target.checked)}
          />
          {t("Шторка уведомлений")}
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void apply(
            {
              width: Number(values.width),
              height: Number(values.height),
              device: {
                preset: "custom",
                orientation:
                  Number(values.width) > Number(values.height)
                    ? "landscape"
                    : "portrait",
                cutout: values.cutout,
                safeArea: values.safeArea,
              },
            },
            values.baseRevision,
          );
        }}
      >
        <label>
          {t("Ширина")}
          <input
            aria-label={t("Ширина экрана")}
            type="number"
            min={320}
            max={3840}
            step={1}
            value={values.width}
            disabled={disabled || busy}
            onChange={(e) => {
              setValues({ ...values, width: e.target.value });
              setEditing(true);
            }}
          />
        </label>
        <span aria-hidden="true">×</span>
        <label>
          {t("Высота")}
          <input
            aria-label={t("Высота экрана")}
            type="number"
            min={240}
            max={3840}
            step={1}
            value={values.height}
            disabled={disabled || busy}
            onChange={(e) => {
              setValues({ ...values, height: e.target.value });
              setEditing(true);
            }}
          />
        </label>
        <StudioButton
          type="submit"
          className="accent"
          disabled={disabled || busy || !editing}
        >
          {t("Применить размеры")}
        </StudioButton>
        {editing && (
          <StudioButton
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setError("");
            }}
          >
            {t("Сбросить размеры")}
          </StudioButton>
        )}
        <details>
          <summary>{t("Системные зоны и вырез")}</summary>
          <div className="safe-area-fields">
            {(["top", "right", "bottom", "left"] as (keyof SafeArea)[]).map(
              (side, i) => (
                <label key={side}>
                  {[t("Сверху"), t("Справа"), t("Снизу"), t("Слева")][i]}
                  <input
                    aria-label={
                      t("Системная зона ") +
                      [t("сверху"), t("справа"), t("снизу"), t("слева")][i]
                    }
                    type="number"
                    min={0}
                    max={240}
                    step={1}
                    value={values.safeArea[side]}
                    disabled={disabled || busy}
                    onChange={(e) => {
                      setValues({
                        ...values,
                        safeArea: {
                          ...values.safeArea,
                          [side]: Number(e.target.value),
                        },
                      });
                      setEditing(true);
                    }}
                  />
                </label>
              ),
            )}
            <label>
              {t("Вырез")}
              <select
                aria-label={t("Вырез устройства")}
                value={values.cutout}
                disabled={disabled || busy}
                onChange={(e) => {
                  setValues({
                    ...values,
                    cutout: e.target.value as typeof values.cutout,
                  });
                  setEditing(true);
                }}
              >
                <option value="none">{t("Нет")}</option>
                <option value="pill">{t("Островок")}</option>
                <option value="notch">{t("Вырез")}</option>
              </select>
            </label>
          </div>
        </details>
      </form>
      <div className="viewport-bulk-actions">
        <StudioButton
          disabled={disabled || busy || !pageCount}
          onClick={() => void bulk()}
        >
          {t("Применить ко всем")}
        </StudioButton>
        <StudioSelect
          label={t("Группа для применения устройства")}
          value={selectedGroup?.id ?? ""}
          fallback={t("Выбери группу")}
          disabled={disabled || busy || !groups.length}
          onChange={setTargetGroup}
          sections={[
            {
              label: "",
              options: groups.map((group) => ({
                value: group.id,
                label: t("{0} · {1} экранов", {
                  0: group.name,
                  1: group.pages.length,
                }),
              })),
            },
          ]}
        />
        <StudioButton
          disabled={disabled || busy || !selectedGroup?.pages.length}
          onClick={() => void bulk(selectedGroup!.id)}
        >
          {t("Применить к группе")}
        </StudioButton>
        <small>
          {t("Все:")} {pageCount} {t("экранов · выбранная группа:")}{" "}
          {selectedGroup?.pages.length ?? 0}
          {t(". Используются текущие размеры, вырез и системные зоны.")}
        </small>
      </div>
      {bulkStatus && (
        <p className="notice" role="status">
          {bulkStatus}
        </p>
      )}
      <small>
        {t("CSS px · рабочая область")} {size.width} × {size.height}{" "}
        {t("· системные зоны — визуальная модель")}
      </small>
      {editing && values.baseRevision !== revision && (
        <p className="notice" role="status">
          {t("Документ изменился. Твой ввод размеров сохранён.")}{" "}
          <StudioButton
            disabled={disabled || busy}
            onClick={() => setValues({ ...values, baseRevision: revision })}
          >
            {t("Использовать новую ревизию")}
          </StudioButton>
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
