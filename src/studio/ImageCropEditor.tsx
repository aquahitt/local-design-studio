import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Matrix, Point } from "../core/scene";
import type {
  TransformGesture,
  TransformHandle,
  TransformRotationState,
} from "../core/transform-gesture";
import {
  createImageMappingGesture,
  adjustImageMapping,
  updateImageMappingGesture,
} from "./imageMappingGesture";
import { FramePaintLayer } from "./FramePaintLayer";
import { TransformHandles } from "./TransformHandles";
import { restoreFocusOnClose } from "./shortcuts";
import { useI18n } from "./i18n";
import "./ImageCropEditor.css";

/** Isolated local-frame editor. It never publishes document canvas context. */
export function ImageCropEditor({
  asset,
  mode,
  matrix,
  width,
  height,
  disabled,
  scope,
  onChange,
  onClose,
}: {
  asset: string;
  mode: "crop" | "tile";
  matrix: Matrix;
  width: number;
  height: number;
  disabled: boolean;
  scope: string;
  onChange: (matrix: Matrix) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 560, height: 360 });
  const [preview, setPreview] = useState<Matrix | null>(null),
    [error, setError] = useState("");
  const current = useRef({ scope, disabled, matrix, onChange });
  current.current = { scope, disabled, matrix, onChange };
  type Drag = {
    pointerId: number;
    capture: TransformGesture;
    state: TransformRotationState;
    identity: string;
    source: Matrix;
    raf?: number;
    latest?: Matrix;
  };
  const drag = useRef<Drag | null>(null);
  function cancel() {
    if (drag.current?.raf !== undefined) cancelAnimationFrame(drag.current.raf);
    drag.current = null;
    setPreview(null);
  }
  useEffect(() => {
    const restore = restoreFocusOnClose(document);
    dialog.current?.showModal();
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (surface.current) observer.observe(surface.current);
    const blur = () => cancel();
    window.addEventListener("blur", blur);
    return () => {
      cancel();
      observer.disconnect();
      window.removeEventListener("blur", blur);
      restore();
    };
  }, []);
  useEffect(() => {
    cancel();
  }, [scope, disabled]);
  // A parent edit while dragging invalidates the captured matrix. Never retarget.
  useEffect(() => {
    if (
      drag.current &&
      JSON.stringify(matrix) !== JSON.stringify(drag.current.source)
    )
      cancel();
  }, [matrix]);
  useEffect(() => {
    cancel();
  }, [size.width, size.height]);
  const zoom = Math.max(
    0.00001,
    Math.min((size.width - 104) / width, (size.height - 104) / height),
  );
  const panX = (size.width - width * zoom) / 2,
    panY = (size.height - height * zoom) / 2;
  const effective = preview ?? matrix;
  const frame = createImageMappingGesture(effective, {
    tool: "move",
    pointer: { x: 0, y: 0 },
  }).frame;
  function point(event: { clientX: number; clientY: number }): Point {
    const box = surface.current!.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - panX) / zoom,
      y: (event.clientY - box.top - panY) / zoom,
    };
  }
  function start(
    event: PointerEvent<HTMLElement>,
    tool: "move" | "resize" | "scale" | "rotate",
    handle?: TransformHandle,
  ) {
    if (disabled || event.button !== 0 || tool === "resize") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
    setError("");
    try {
      const capture = createImageMappingGesture(matrix, {
        tool,
        handle,
        pointer: point(event),
      });
      drag.current = {
        pointerId: event.pointerId,
        capture,
        state: capture.rotationState,
        identity: scope,
        source: [...matrix],
      };
      surface.current?.setPointerCapture(event.pointerId);
    } catch {
      setError("Невозможно преобразовать изображение.");
    }
  }
  function update(event: PointerEvent<HTMLDivElement>, final: boolean) {
    const value = drag.current;
    if (!value || value.pointerId !== event.pointerId) return;
    const latest = current.current;
    if (
      latest.disabled ||
      latest.scope !== value.identity ||
      JSON.stringify(latest.matrix) !== JSON.stringify(value.source)
    ) {
      cancel();
      return;
    }
    const result = updateImageMappingGesture(
      value.capture,
      point(event),
      {
        altKey: event.altKey,
        shiftKey: value.capture.tool === "scale" || event.shiftKey,
      },
      value.state,
    );
    value.state = result.rotationState;
    if (!result.valid) {
      value.latest = undefined;
      if (final) {
        cancel();
        setError("Невозможно преобразовать изображение.");
      }
      return;
    }
    if (final) {
      cancel();
      if (result.changed) latest.onChange(result.matrix);
      return;
    }
    value.latest = result.matrix;
    if (value.raf === undefined)
      value.raf = requestAnimationFrame(() => {
        value.raf = undefined;
        if (
          drag.current === value &&
          current.current.scope === value.identity &&
          !current.current.disabled
        )
          setPreview(value.latest ?? null);
      });
  }
  function nudge(dx: number, dy: number) {
    if (disabled) return;
    const capture = createImageMappingGesture(matrix, {
      tool: "move",
      pointer: { x: 0, y: 0 },
    });
    const result = updateImageMappingGesture(capture, { x: dx, y: dy });
    if (result.valid && result.changed) onChange(result.matrix);
  }
  function adjust(
    value:
      { kind: "scale"; factor: number } | { kind: "rotate"; degrees: number },
  ) {
    if (disabled) return;
    cancel();
    setError("");
    try {
      onChange(adjustImageMapping(matrix, value));
    } catch {
      setError("Невозможно преобразовать изображение.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="image-crop-dialog"
      aria-label={t("Кадрирование изображения")}
      onCancel={(event) => {
        event.preventDefault();
        if (drag.current) cancel();
        else onClose();
      }}
    >
      <header>
        <h2>{t("Кадрирование изображения")}</h2>
        <button type="button" onClick={onClose}>
          {t("Готово")}
        </button>
      </header>
      <p>
        {t(
          "Перетащи изображение. Ручки меняют масштаб и поворот. Стрелки сдвигают на 1 px, Shift — на 10 px. Изменения останутся в черновике до применения слоя.",
        )}
      </p>
      <div
        ref={surface}
        className="image-crop-surface"
        tabIndex={0}
        role="group"
        aria-label={t("Область кадрирования")}
        onPointerDown={(event) => start(event, "move")}
        onPointerMove={(event) => update(event, false)}
        onPointerUp={(event) => update(event, true)}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
          }
          const delta = (
            {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            } as Record<string, number[]>
          )[event.key];
          if (delta) {
            event.preventDefault();
            nudge(
              delta[0] * (event.shiftKey ? 10 : 1),
              delta[1] * (event.shiftKey ? 10 : 1),
            );
          }
        }}
      >
        <div
          className="image-crop-window"
          style={{
            left: panX,
            top: panY,
            width: width * zoom,
            height: height * zoom,
          }}
        >
          <FramePaintLayer
            nodeId="image-crop-editor"
            scene={{
              kind: "frame",
              x: 0,
              y: 0,
              width,
              height,
              fills: [
                {
                  id: "image",
                  kind: "image",
                  asset,
                  mapping: { mode, imageToFrame: effective },
                },
              ],
            }}
          />
        </div>
        <TransformHandles
          frame={frame}
          view={{ zoom, panX, panY }}
          mode="scale"
          disabled={disabled}
          onStart={start}
        />
      </div>
      <div
        className="image-crop-actions"
        role="group"
        aria-label={t("Масштаб и поворот изображения")}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => adjust({ kind: "scale", factor: 0.8 })}
        >
          {t("Уменьшить изображение")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => adjust({ kind: "scale", factor: 1.25 })}
        >
          {t("Увеличить изображение")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => adjust({ kind: "rotate", degrees: -15 })}
        >
          {t("Повернуть изображение на −15°")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => adjust({ kind: "rotate", degrees: 15 })}
        >
          {t("Повернуть изображение на 15°")}
        </button>
      </div>
      {error && <p role="alert">{t(error)}</p>}
    </dialog>
  );
}
