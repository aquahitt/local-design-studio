import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { Project, ProjectNode, ProjectPage } from "../core/project";
import type { Operation } from "../core/operations";
import type { Point, SceneView } from "../core/scene";
import { translateSceneLayers } from "../core/geometry-commands";
import type { ComponentLibrary } from "../library/sdk";
import { Preview } from "./Preview";
import {
  fitCanvasBounds,
  readCanvasView,
  zoomCanvasAt,
  type CanvasBounds,
} from "./canvasCamera";
import { useI18n } from "./i18n";
import "./CanvasSurface.css";
function CanvasIcon({ path }: { path: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
type Basis = {
  id: string;
  x: number;
  y: number;
  xx: number;
  xy: number;
  yx: number;
  yy: number;
};
type Gesture = {
  pointer: number;
  from: Point;
  last: Point;
  view: SceneView;
  size: { width: number; height: number };
  locale: string;
  revision: number;
  project: Project;
  pan: boolean;
  requestId: number;
  additive: boolean;
  ended: boolean;
  ids?: string[];
  basis?: Basis[];
  blockedReason?: string;
};
export type CanvasContext = {
  revision: number | null;
  transient: boolean;
  view: SceneView;
  bounds: CanvasBounds[];
  width: number;
  height: number;
};
export function CanvasSurface({
  project,
  page,
  library,
  selectedIds,
  disabled,
  onSelection,
  mutate,
  onContext,
}: {
  project: Project;
  page: ProjectPage;
  library: ComponentLibrary;
  selectedIds: string[];
  disabled: boolean;
  onSelection: (ids: string[]) => boolean;
  mutate: (
    operations: Operation[],
    description: string,
    revision?: number,
  ) => Promise<void>;
  onContext?: (context: CanvasContext) => void;
}) {
  const { t, locale } = useI18n();
  const surface = useRef<HTMLDivElement>(null);
  const key = `local-design-studio:canvas:v1:${project.projectId}:${page.screenId}`;
  const initial = useRef<SceneView | null>(null);
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    try {
      initial.current = readCanvasView(localStorage.getItem(key));
    } catch {
      /* optional storage */
    }
  }
  const [view, setView] = useState<SceneView>(
    initial.current ?? { zoom: 1, panX: 48, panY: 48 },
  );
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [bounds, setBounds] = useState<CanvasBounds[]>([]);
  const [geometryEpoch, setGeometryEpoch] = useState<number | null>(null);
  const [geometryRevision, setGeometryRevision] = useState<number | null>(null);
  const [grid, setGrid] = useState(() => {
      try {
        return localStorage.getItem(key + ":grid") !== "off";
      } catch {
        return true;
      }
    }),
    [hand, setHand] = useState(false),
    [space, setSpace] = useState(false),
    [error, setError] = useState("");
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const renderState = useRef({
    view,
    positions,
    size,
    locale,
    revision: project.revision,
    epoch: 0,
  });
  if (
    renderState.current.view !== view ||
    renderState.current.positions !== positions ||
    renderState.current.size !== size ||
    renderState.current.locale !== locale ||
    renderState.current.revision !== project.revision
  )
    renderState.current = {
      view,
      positions,
      size,
      locale,
      revision: project.revision,
      epoch: renderState.current.epoch + 1,
    };
  const epoch = renderState.current.epoch;
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const [pick, setPick] = useState<{
    requestId: number;
    x: number;
    y: number;
  }>();
  const surfaceId = useRef(crypto.randomUUID()).current;
  const count = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({
    project,
    disabled,
    onSelection,
    mutate,
    selectedIds,
    view,
  });
  latest.current = {
    project,
    disabled,
    onSelection,
    mutate,
    selectedIds,
    view,
  };
  const fitted = useRef(!!initial.current);
  const viewRef = useRef(view);
  viewRef.current = view;
  const updateView = useCallback(
    (next: SceneView | ((current: SceneView) => SceneView)) =>
      setView((current) => {
        const v = typeof next === "function" ? next(current) : next;
        return {
          zoom: v.zoom,
          panX: Math.max(-1e9, Math.min(1e9, v.panX)),
          panY: Math.max(-1e9, Math.min(1e9, v.panY)),
        };
      }),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ version: 1, ...view }));
      } catch {
        /* optional storage */
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [key, view]);
  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, ...viewRef.current }),
        );
      } catch {
        /* optional storage */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [key]);
  useEffect(() => {
    try {
      localStorage.setItem(key + ":grid", grid ? "on" : "off");
    } catch {
      /* optional storage */
    }
  }, [key, grid]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let measured = false;
    const observer = new ResizeObserver(([entry]) =>
      setSize((old) => {
        const next = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
        if (old.width === next.width && old.height === next.height) return old;
        if (measured && fitted.current)
          updateView((v) => ({
            ...v,
            panX: v.panX + (next.width - old.width) / 2,
            panY: v.panY + (next.height - old.height) / 2,
          }));
        measured = true;
        return next;
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [updateView]);
  const receiveGeometry = useCallback(
    (next: CanvasBounds[], revision: number, receivedEpoch: number) => {
      setBounds(next);
      setGeometryRevision(revision);
      setGeometryEpoch(receivedEpoch);
    },
    [],
  );
  useEffect(() => {
    if (!fitted.current && bounds.length && size.width > 0) {
      fitted.current = true;
      updateView(fitCanvasBounds(bounds, size));
    }
  }, [bounds, size, updateView]);
  useEffect(() => {
    onContext?.({
      view,
      bounds: geometryEpoch === epoch ? bounds : [],
      ...size,
      revision: geometryEpoch === epoch ? geometryRevision : null,
      transient: Object.keys(positions).length > 0,
    });
  }, [
    view,
    bounds,
    size,
    geometryRevision,
    geometryEpoch,
    epoch,
    positions,
    onContext,
  ]);
  const cancel = useCallback(() => {
    gesture.current = null;
    setPositions({});
    setSpace(false);
  }, []);
  useEffect(() => {
    const g = gesture.current;
    if (
      g &&
      (g.size !== size || g.locale !== locale || (!g.pan && g.view !== view))
    )
      cancel();
  }, [view, size, locale, cancel]);
  useEffect(() => {
    if (gesture.current && gesture.current.revision !== project.revision) {
      const moved =
        gesture.current.last.x !== gesture.current.from.x ||
        gesture.current.last.y !== gesture.current.from.y;
      cancel();
      if (moved) setError(t("Документ изменился. Перемещение отменено."));
    }
  }, [project.revision, cancel, t]);
  useEffect(() => {
    const blur = () => cancel();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [cancel]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (gesture.current) return;
      const scale =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.height : 1;
      if (e.ctrlKey || e.metaKey) {
        const rect = element.getBoundingClientRect();
        updateView((v) =>
          zoomCanvasAt(
            v,
            { x: e.clientX - rect.x, y: e.clientY - rect.y },
            v.zoom * Math.exp(-e.deltaY * scale * 0.002),
          ),
        );
      } else
        updateView((v) => ({
          ...v,
          panX: v.panX - e.deltaX * scale,
          panY: v.panY - e.deltaY * scale,
        }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [size.height, updateView]);
  function operations(g: Gesture) {
    const dx = (g.last.x - g.from.x) / g.view.zoom,
      dy = (g.last.y - g.from.y) / g.view.zoom;
    return (g.basis ?? []).map((b) => ({
      type: "setNodeMetadata" as const,
      nodeId: b.id,
      scene: { x: b.x + b.xx * dx + b.xy * dy, y: b.y + b.yx * dx + b.yy * dy },
    }));
  }
  function finish(g: Gesture) {
    if (g !== gesture.current) return;
    if (!g.pan && !g.ids) return; // Pick may still be in flight.
    gesture.current = null;
    setPositions({});
    if (
      g.pan ||
      Math.hypot(g.last.x - g.from.x, g.last.y - g.from.y) < 3 ||
      !g.basis
    )
      return;
    if (
      latest.current.disabled ||
      latest.current.project.revision !== g.revision
    ) {
      setError(t("Документ изменился. Перемещение отменено."));
      return;
    }
    void latest.current
      .mutate(operations(g), t("Переместить слои на холсте"), g.revision)
      .catch((e) => setError(e.message));
  }
  function move(g: Gesture) {
    if (g.pan) {
      updateView({
        ...g.view,
        panX: g.view.panX + g.last.x - g.from.x,
        panY: g.view.panY + g.last.y - g.from.y,
      });
      return;
    }
    if (Math.hypot(g.last.x - g.from.x, g.last.y - g.from.y) < 3) return;
    if (!g.basis) {
      if (g.blockedReason)
        setError(
          t("Этот слой нельзя переместить на холсте.") + " " + g.blockedReason,
        );
      return;
    }
    setPositions(
      Object.fromEntries(
        operations(g).map((op) => [op.nodeId, op.scene! as Point]),
      ),
    );
  }
  const receivePick = useCallback(
    (id: string | null, requestId: number) => {
      const g = gesture.current;
      if (
        !g ||
        g.pan ||
        g.requestId !== requestId ||
        latest.current.project.revision !== g.revision
      )
        return;
      const current = latest.current;
      let ids = id
        ? g.additive
          ? current.selectedIds.includes(id)
            ? current.selectedIds.filter((v) => v !== id)
            : [...current.selectedIds, id]
          : current.selectedIds.includes(id)
            ? current.selectedIds
            : [id]
        : [];
      if (!current.onSelection(ids)) {
        gesture.current = null;
        return;
      }
      g.ids = ids;
      if (id && ids.includes(id) && !g.additive && !current.disabled) {
        try {
          const base = translateSceneLayers(g.project, ids, { x: 0, y: 0 }),
            x = translateSceneLayers(g.project, ids, { x: 1, y: 0 }),
            y = translateSceneLayers(g.project, ids, { x: 0, y: 1 });
          g.basis = base.map((op, i) => {
            if (
              op.type !== "setNodeMetadata" ||
              x[i].type !== "setNodeMetadata" ||
              y[i].type !== "setNodeMetadata"
            )
              throw new Error("INVALID_TRANSLATION");
            const b = op.scene!,
              a = (x[i] as typeof op).scene!,
              c = (y[i] as typeof op).scene!;
            return {
              id: op.nodeId,
              x: b.x!,
              y: b.y!,
              xx: a.x! - b.x!,
              xy: c.x! - b.x!,
              yx: a.y! - b.y!,
              yy: c.y! - b.y!,
            };
          });
        } catch (e) {
          g.blockedReason = (e as Error).message;
        }
      }
      move(g);
      if (g.ended) finish(g);
    },
    [t],
  );
  function point(e: PointerEvent) {
    const b = surface.current!.getBoundingClientRect();
    return { x: e.clientX - b.x, y: e.clientY - b.y };
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    surface.current?.focus({ preventScroll: true });
    surface.current?.setPointerCapture(e.pointerId);
    setError("");
    const p = point(e);
    const g: Gesture = {
      pointer: e.pointerId,
      from: p,
      last: p,
      view,
      size,
      locale,
      revision: project.revision,
      project,
      pan: hand || space || e.button === 1,
      requestId: ++count.current,
      additive: e.shiftKey,
      ended: false,
    };
    gesture.current = g;
    if (!g.pan) setPick({ requestId: g.requestId, ...p });
  }
  function applyZoom() {
    const value = Number(zoomDraft);
    if (zoomDraft !== null && Number.isFinite(value) && value > 0)
      updateView((v) =>
        zoomCanvasAt(v, { x: size.width / 2, y: size.height / 2 }, value / 100),
      );
    setZoomDraft(null);
  }
  function fit(selected = false) {
    const rows = selected
      ? bounds.filter((b) => selectedIds.includes(b.id))
      : bounds;
    updateView(fitCanvasBounds(rows, size));
    fitted.current = true;
  }
  const center = { x: size.width / 2, y: size.height / 2 };
  const spacing = 24 * view.zoom;
  return (
    <section className="canvas-editor">
      <div
        className="canvas-toolbar"
        role="toolbar"
        aria-label={t("Камера холста")}
      >
        <button
          type="button"
          aria-label={t("Инструмент выбора")}
          aria-pressed={!hand}
          onClick={() => setHand(false)}
        >
          <CanvasIcon path="M4 3l16 9-7 2-3 7-6-18z" />
        </button>
        <button
          type="button"
          aria-label={t("Рука: перемещение холста")}
          aria-pressed={hand}
          onClick={() => setHand((v) => !v)}
        >
          <CanvasIcon path="M8 13V6a2 2 0 014 0v6-8a2 2 0 014 0v8-6a2 2 0 014 0v9c0 4-3 7-7 7h-1c-2 0-3-1-4-3l-4-6a2 2 0 013-2l1 2z" />
        </button>
        <button
          type="button"
          aria-label={t("Уменьшить масштаб")}
          onClick={() =>
            updateView((v) => zoomCanvasAt(v, center, v.zoom / 1.25))
          }
        >
          <CanvasIcon path="M5 12h14" />
        </button>
        <label className="canvas-zoom">
          <input
            type="number"
            min="5"
            max="1600"
            step="5"
            aria-label={t("Масштаб холста, проценты")}
            value={zoomDraft ?? Math.round(view.zoom * 100)}
            onChange={(e) => setZoomDraft(e.target.value)}
            onBlur={applyZoom}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyZoom();
              }
              if (e.key === "Escape") setZoomDraft(null);
            }}
          />
          %
        </label>
        <button
          type="button"
          aria-label={t("Увеличить масштаб")}
          onClick={() =>
            updateView((v) => zoomCanvasAt(v, center, v.zoom * 1.25))
          }
        >
          <CanvasIcon path="M5 12h14M12 5v14" />
        </button>
        <button
          type="button"
          aria-label={t("Масштаб 100%")}
          onClick={() => updateView((v) => zoomCanvasAt(v, center, 1))}
        >
          <CanvasIcon path="M4 9a8 8 0 111 9M4 4v5h5" />
        </button>
        <button type="button" onClick={() => fit()}>
          {t("Вместить всё")}
        </button>
        <button
          type="button"
          disabled={!selectedIds.length}
          onClick={() => fit(true)}
        >
          {t("Вместить выделение")}
        </button>
        <button
          type="button"
          aria-label={t("Сетка холста")}
          aria-pressed={grid}
          onClick={() => setGrid((v) => !v)}
        >
          <CanvasIcon path="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
        </button>
      </div>
      <div
        ref={surface}
        role="region"
        tabIndex={0}
        aria-label={t("Свободный холст")}
        aria-describedby={"canvas-help-" + surfaceId}
        className={"canvas-surface" + (hand || space ? " canvas-hand" : "")}
        data-zoom={view.zoom}
        data-pan-x={view.panX}
        data-pan-y={view.panY}
        style={
          grid
            ? {
                backgroundImage:
                  "radial-gradient(circle,var(--studio-muted,#7c8799) .65px,transparent .8px)",
                backgroundSize: `${Math.max(6, spacing)}px ${Math.max(6, spacing)}px`,
                backgroundPosition: `${view.panX}px ${view.panY}px`,
              }
            : undefined
        }
        onPointerDown={down}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (g && g.pointer === e.pointerId) {
            g.last = point(e);
            move(g);
          }
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          if (g && g.pointer === e.pointerId) {
            g.last = point(e);
            g.ended = true;
            finish(g);
          }
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (gesture.current && !gesture.current.ended) cancel();
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return;
          if (e.key === " ") {
            e.preventDefault();
            setSpace(true);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          if (e.key === "1" && e.shiftKey) {
            e.preventDefault();
            fit();
          }
          if (e.key === "2" && e.shiftKey) {
            e.preventDefault();
            fit(true);
          }
          if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            updateView((v) => zoomCanvasAt(v, center, v.zoom * 1.25));
          }
          if (e.key === "-") {
            e.preventDefault();
            updateView((v) => zoomCanvasAt(v, center, v.zoom / 1.25));
          }
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            e.preventDefault();
            const step = e.shiftKey ? 160 : 40;
            updateView((v) => ({
              ...v,
              panX:
                v.panX +
                (e.key === "ArrowLeft"
                  ? step
                  : e.key === "ArrowRight"
                    ? -step
                    : 0),
              panY:
                v.panY +
                (e.key === "ArrowUp"
                  ? step
                  : e.key === "ArrowDown"
                    ? -step
                    : 0),
            }));
          }
          if (e.key === "0") {
            e.preventDefault();
            updateView((v) => zoomCanvasAt(v, center, 1));
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " ") setSpace(false);
        }}
        onBlur={() => {
          setSpace(false);
          if (gesture.current) cancel();
        }}
      >
        <div className="canvas-frame" aria-hidden="true">
          <Preview
            library={library}
            project={project}
            theme={project.theme}
            title={t("Холст ") + page.name}
            height={size.height}
            nodes={page.nodes}
            canvas={{ surfaceId, epoch, view, positions, pick }}
            onGeometry={receiveGeometry}
            onPick={receivePick}
          />
        </div>
        <div className="canvas-capture" />
        {bounds
          .filter((b) => selectedIds.includes(b.id))
          .map((b) => (
            <div
              key={b.id}
              className="canvas-selection"
              style={{
                left: b.x * view.zoom + view.panX,
                top: b.y * view.zoom + view.panY,
                width: b.width * view.zoom,
                height: b.height * view.zoom,
              }}
            />
          ))}
      </div>
      <p id={"canvas-help-" + surfaceId} className="canvas-help">
        {t(
          "Колесо — перемещение · Ctrl/⌘ + колесо — масштаб · пробел — рука · Shift + 1 — вместить всё",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
