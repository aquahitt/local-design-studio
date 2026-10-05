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
          ? "Размеры: ширина 320–3840, высота 240–3840, зоны 0–240 px; рабочая область не меньше 120 × 120."
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
        `Применено к ${result.count} экранам.` +
          (editing && !result.includesCurrent
            ? " Ввод текущего экрана сохранён в черновике."
            : ""),
      );
    } catch (error) {
      setError(
        (error as Error).message === "INVALID_VIEWPORT"
          ? "Проверь размеры и системные зоны: рабочая область должна быть не меньше 120 × 120 px."
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
          Устройство
          <select
            aria-label="Тип устройства"
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
            <option value="custom">Свои размеры</option>
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
          Повернуть устройство
        </StudioButton>
        <label className="shade-toggle">
          <input
            type="checkbox"
            aria-label="Шторка уведомлений"
            checked={shade}
            onChange={(e) => onShadeChange(e.target.checked)}
          />
          Шторка уведомлений
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
          Ширина
          <input
            aria-label="Ширина экрана"
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
          Высота
          <input
            aria-label="Высота экрана"
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
          Применить размеры
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
            Сбросить размеры
          </StudioButton>
        )}
        <details>
          <summary>Системные зоны и вырез</summary>
          <div className="safe-area-fields">
            {(["top", "right", "bottom", "left"] as (keyof SafeArea)[]).map(
              (side, i) => (
                <label key={side}>
                  {["Сверху", "Справа", "Снизу", "Слева"][i]}
                  <input
                    aria-label={
                      "Системная зона " +
                      ["сверху", "справа", "снизу", "слева"][i]
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
              Вырез
              <select
                aria-label="Вырез устройства"
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
                <option value="none">Нет</option>
                <option value="pill">Островок</option>
                <option value="notch">Вырез</option>
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
          Применить ко всем
        </StudioButton>
        <StudioSelect
          label="Группа для применения устройства"
          value={selectedGroup?.id ?? ""}
          fallback="Выбери группу"
          disabled={disabled || busy || !groups.length}
          onChange={setTargetGroup}
          sections={[
            {
              label: "",
              options: groups.map((group) => ({
                value: group.id,
                label: `${group.name} · ${group.pages.length} экранов`,
              })),
            },
          ]}
        />
        <StudioButton
          disabled={disabled || busy || !selectedGroup?.pages.length}
          onClick={() => void bulk(selectedGroup!.id)}
        >
          Применить к группе
        </StudioButton>
        <small>
          Все: {pageCount} экранов · выбранная группа:{" "}
          {selectedGroup?.pages.length ?? 0}. Используются текущие размеры,
          вырез и системные зоны.
        </small>
      </div>
      {bulkStatus && (
        <p className="notice" role="status">
          {bulkStatus}
        </p>
      )}
      <small>
        CSS px · рабочая область {size.width} × {size.height} · системные зоны —
        визуальная модель
      </small>
      {editing && values.baseRevision !== revision && (
        <p className="notice" role="status">
          Документ изменился. Твой ввод размеров сохранён.{" "}
          <StudioButton
            disabled={disabled || busy}
            onClick={() => setValues({ ...values, baseRevision: revision })}
          >
            Использовать новую ревизию
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
