import {
  buildSnapIndex,
  solveTransformSnapping,
  type SnapIndex,
  type SnapState,
  type SnapMatch,
} from "../core/snapping";
import { GUIDE_LIMITS, type PageGuide } from "../core/guides";
import { SnapOverlay } from "./SnapOverlay";
import { CanvasRulers } from "./CanvasRulers";
import { CanvasGuideOverlay } from "./CanvasGuides";
import { RULER_THICKNESS } from "./rulerGeometry";
import { measuredCanvasContext, type CanvasContext } from "./canvasContext";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { Project, ProjectPage } from "../core/project";
import type { Operation } from "../core/operations";
import type { Point, SceneView } from "../core/scene";
import {
  getTransformFrame,
  type TransformFrame,
} from "../core/affine-geometry";
import {
  createTransformGesture,
  type TransformGesture,
  type TransformHandle,
  type TransformRotationState,
} from "../core/transform-gesture";
import { geometryResult, type SceneGeometryMap } from "./transientGeometry";
import { TransformHandles } from "./TransformHandles";
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
type Gesture = {
  token: number;
  pointer: number;
  from: Point;
  last: Point;
  view: SceneView;
  size: { width: number; height: number };
  locale: string;
  revision: number;
  project: Project;
  pageId: string;
  mode: "resize" | "scale";
  selection: string[];
  pan: boolean;
  requestId: number;
  additive: boolean;
  ended: boolean;
  picked: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  snapIndex?: SnapIndex;
  snapState?: SnapState;
  snapLines?: SnapMatch[];
  transform?: TransformGesture;
  rotation?: TransformRotationState;
  blocked?: boolean;
  modeAfterPick?: "resize" | "scale";
};
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);
export type { CanvasContext } from "./canvasContext";
export function CanvasSurface({
  project,
  page,
  library,
  selectedIds,
  disabled,
  onSelection,
  mutate,
  onContext,
  onOpenTransformControls,
  onManageGuides,
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
  onOpenTransformControls?: () => void;
  onManageGuides?: (initial?: {
    axis: PageGuide["axis"];
    position: number;
  }) => void;
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
  const readPreference = (name: string, fallback: boolean) => {
    try {
      const value = localStorage.getItem(key + ":" + name);
      return value === null ? fallback : value !== "off";
    } catch {
      return fallback;
    }
  };
  const [snapEnabled, setSnapEnabled] = useState(() =>
    readPreference("snapping", true),
  );
  const [rulers, setRulers] = useState(() => readPreference("rulers", true));
  const [guidesVisible, setGuidesVisible] = useState(() =>
    readPreference("guides", true),
  );
  const [snapLines, setSnapLines] = useState<SnapMatch[]>([]);
  type GuideGesture = {
    pointer: number;
    projectId: string;
    pageId: string;
    revision: number;
    view: SceneView;
    size: typeof size;
    locale: string;
    guide: PageGuide;
    isNew: boolean;
    from: Point;
    last: Point;
    position: number;
    token: number;
  };
  const guideGesture = useRef<GuideGesture | null>(null);
  const guideRaf = useRef<number | null>(null);
  const [guidePreview, setGuidePreview] = useState<PageGuide | null>(null);
  const [geometry, setGeometry] = useState<SceneGeometryMap>({});
  const [gestureTransient, setTransient] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const committing = useRef(false);
  const transient = gestureTransient || commitBusy;
  const [mode, setMode] = useState<"resize" | "scale">("resize");
  const [gestureFrame, setGestureFrame] = useState<TransformFrame | null>(null);
  const raf = useRef<number | null>(null);
  const lifetime = useRef(0);
  const renderState = useRef({
    view,
    geometry,
    projectId: project.projectId,
    pageId: page.screenId,
    size,
    locale,
    revision: project.revision,
    epoch: 0,
  });
  if (
    renderState.current.view !== view ||
    renderState.current.geometry !== geometry ||
    renderState.current.projectId !== project.projectId ||
    renderState.current.pageId !== page.screenId ||
    renderState.current.size !== size ||
    renderState.current.locale !== locale ||
    renderState.current.revision !== project.revision
  )
    renderState.current = {
      view,
      geometry,
      projectId: project.projectId,
      pageId: page.screenId,
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
    size,
    locale,
    mode,
    pageId: page.screenId,
    hand,
    space,
    snapEnabled,
    guidesVisible,
  });
  latest.current = {
    project,
    disabled,
    onSelection,
    mutate,
    selectedIds,
    view,
    size,
    locale,
    mode,
    pageId: page.screenId,
    hand,
    space,
    snapEnabled,
    guidesVisible,
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
    try {
      localStorage.setItem(key + ":snapping", snapEnabled ? "on" : "off");
      localStorage.setItem(key + ":rulers", rulers ? "on" : "off");
      localStorage.setItem(key + ":guides", guidesVisible ? "on" : "off");
    } catch {
      /* optional preferences */
    }
  }, [key, snapEnabled, rulers, guidesVisible]);
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
    onContext?.(
      measuredCanvasContext({
        projectId: project.projectId,
        pageId: page.screenId,
        view,
        bounds,
        ...size,
        revision: geometryRevision,
        transient,
        epoch,
        measuredEpoch:
          geometryRevision === project.revision ? geometryEpoch : null,
      }),
    );
  }, [
    view,
    bounds,
    size,
    geometryRevision,
    geometryEpoch,
    epoch,
    transient,
    project.projectId,
    page.screenId,
    project.revision,
    onContext,
  ]);
  const cancel = useCallback(() => {
    ++lifetime.current;
    gesture.current = null;
    guideGesture.current = null;
    if (guideRaf.current !== null) cancelAnimationFrame(guideRaf.current);
    guideRaf.current = null;
    setGuidePreview(null);
    setSnapLines([]);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPick(undefined);
    setGeometry((current) => (Object.keys(current).length ? {} : current));
    setGestureFrame(null);
    setTransient(false);
  }, []);
  function currentGesture(g: Gesture) {
    const c = latest.current;
    return (
      gesture.current === g &&
      lifetime.current === g.token &&
      c.project.projectId === g.project.projectId &&
      c.pageId === g.pageId &&
      c.project.revision === g.revision &&
      c.size === g.size &&
      c.locale === g.locale &&
      (g.pan ||
        (!c.disabled &&
          !committing.current &&
          c.view === g.view &&
          c.mode === g.mode &&
          !c.hand &&
          !c.space &&
          sameIds(c.selectedIds, g.selection)))
    );
  }
  useEffect(() => {
    const g = gesture.current;
    if (g && !currentGesture(g)) {
      cancel();
      if (!g.pan)
        setError(
          t(
            g.transform?.tool === "move" && project.revision !== g.revision
              ? "Документ изменился. Перемещение отменено."
              : "Документ или контекст изменился. Преобразование отменено.",
          ),
        );
    }
  }, [
    project.projectId,
    project.revision,
    page.screenId,
    selectedIds,
    disabled,
    view,
    size,
    locale,
    mode,
    hand,
    space,
    cancel,
    t,
  ]);
  useEffect(() => {
    const blur = () => {
      cancel();
      setSpace(false);
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      cancel();
    };
  }, [cancel]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (gesture.current || guideGesture.current) return;
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
  function world(p: Point, v: SceneView): Point {
    return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom };
  }
  function result(g: Gesture) {
    if (!g.transform) return null;
    const c = latest.current;
    const index = (g.snapIndex ??= buildSnapIndex(g.transform, {
      guides: c.guidesVisible ? undefined : [],
    }));
    const solved = solveTransformSnapping(
      g.transform,
      index,
      world(g.last, g.view),
      {
        zoom: g.view.zoom,
        bypass: !c.snapEnabled || g.ctrlKey || g.metaKey,
        shiftKey: g.shiftKey,
        altKey: g.altKey,
        state: g.snapState,
        rotationState: g.rotation,
      },
    );
    g.rotation = solved.result.rotationState;
    g.snapState = solved.state;
    g.snapLines = solved.guides;
    return solved.result;
  }
  function finish(g: Gesture) {
    if (!currentGesture(g)) {
      cancel();
      return;
    }
    if (!g.pan && !g.picked) return;
    // Read the final coordinates synchronously, even if a preview RAF is pending.
    const value = !g.pan && g.transform ? result(g) : null;
    const moved = Math.hypot(g.last.x - g.from.x, g.last.y - g.from.y) >= 3;
    if (g.blocked && moved)
      setError(t("Этот слой нельзя переместить на холсте."));
    cancel();
    if (g.pan || !g.transform || (g.transform.tool === "move" && !moved))
      return;
    if (!value?.valid) {
      setError(t("Преобразование недопустимо. Изменения отменены."));
      return;
    }
    if (!value.operations.length) return;
    let operations: Operation[];
    try {
      operations = geometryResult(
        value.operations,
        g.project,
        g.pageId,
        g.transform.frame.rootIds,
      ).operations;
    } catch {
      setError(t("Преобразование недопустимо. Изменения отменены."));
      return;
    }
    committing.current = true;
    setCommitBusy(true);
    const description =
      g.transform.tool === "move"
        ? "Переместить слои на холсте"
        : g.transform.tool === "resize"
          ? "Изменить размер слоёв на холсте"
          : g.transform.tool === "scale"
            ? "Масштабировать содержимое на холсте"
            : "Повернуть слои на холсте";
    void latest.current
      .mutate(operations, t(description), g.revision)
      .catch((e) => setError(e.message))
      .finally(() => {
        committing.current = false;
        setCommitBusy(false);
      });
  }
  function publish(g: Gesture) {
    if (!currentGesture(g) || g.pan) return;
    if (!g.transform) {
      if (
        g.blocked &&
        Math.hypot(g.last.x - g.from.x, g.last.y - g.from.y) >= 3
      )
        setError(t("Этот слой нельзя переместить на холсте."));
      return;
    }
    if (
      g.transform.tool === "move" &&
      Math.hypot(g.last.x - g.from.x, g.last.y - g.from.y) < 3
    )
      return;
    const value = result(g);
    if (!value?.valid) {
      setSnapLines([]);
      setGeometry((current) => (Object.keys(current).length ? {} : current));
      setGestureFrame(null);
      setError(t("Преобразование недопустимо. Изменения отменены."));
      return;
    }
    try {
      const next = geometryResult(
        value.operations,
        g.project,
        g.pageId,
        g.transform.frame.rootIds,
      );
      setGeometry(next.geometry);
      setGestureFrame(value.frame);
      setSnapLines(g.snapLines ?? []);
      setError("");
    } catch {
      setError(t("Преобразование недопустимо. Изменения отменены."));
    }
  }
  function move(g: Gesture) {
    if (!currentGesture(g)) {
      cancel();
      return;
    }
    if (g.pan) {
      updateView({
        ...g.view,
        panX: g.view.panX + g.last.x - g.from.x,
        panY: g.view.panY + g.last.y - g.from.y,
      });
      return;
    }
    if (raf.current === null)
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        publish(g);
      });
  }
  const receivePick = useCallback(
    (id: string | null, requestId: number) => {
      const g = gesture.current;
      if (!g || g.pan || g.requestId !== requestId || !currentGesture(g))
        return;
      const c = latest.current;
      const ids = id
        ? g.additive
          ? c.selectedIds.includes(id)
            ? c.selectedIds.filter((v) => v !== id)
            : [...c.selectedIds, id]
          : c.selectedIds.includes(id)
            ? c.selectedIds
            : [id]
        : [];
      g.selection = ids; // The following selection update belongs to this gesture.
      if (!c.onSelection(ids)) {
        cancel();
        return;
      }
      // React may not have rendered the accepted selection before pointerup.
      latest.current = { ...latest.current, selectedIds: ids };
      g.picked = true;
      if (
        id &&
        ids.includes(id) &&
        !g.additive &&
        !c.disabled &&
        !committing.current
      ) {
        try {
          g.transform = createTransformGesture(g.project, ids, {
            tool: "move",
            pointer: world(g.from, g.view),
          });
          g.rotation = g.transform.rotationState;
        } catch {
          g.blocked = true;
        }
      }
      if (g.ended) {
        const nextMode = g.modeAfterPick;
        finish(g);
        if (nextMode) {
          setHand(false);
          setMode(nextMode);
        }
      } else move(g);
    },
    [t, cancel],
  );
  function point(e: PointerEvent) {
    const b = surface.current!.getBoundingClientRect();
    return { x: e.clientX - b.x, y: e.clientY - b.y };
  }
  function begin(e: PointerEvent, pan: boolean): Gesture {
    cancel();
    e.preventDefault();
    surface.current?.focus({ preventScroll: true });
    surface.current?.setPointerCapture(e.pointerId);
    setError("");
    const p = point(e);
    const g: Gesture = {
      token: ++lifetime.current,
      pointer: e.pointerId,
      from: p,
      last: p,
      view,
      size,
      locale,
      revision: project.revision,
      project,
      pageId: page.screenId,
      mode,
      selection: [...selectedIds],
      pan,
      requestId: ++count.current,
      additive: e.shiftKey,
      ended: false,
      picked: pan,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
    gesture.current = g;
    if (!pan) setTransient(true);
    return g;
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const pan = hand || space || e.button === 1;
    if (!pan && disabled) {
      setError(
        t("Есть несохранённый ввод. Примени или сбрось его перед сменой слоя."),
      );
      return;
    }
    if (!pan && committing.current) return;
    const g = begin(e, pan);
    if (!pan) setPick({ requestId: g.requestId, ...g.from });
  }
  function startHandle(
    e: PointerEvent<HTMLButtonElement>,
    tool: "resize" | "scale" | "rotate",
    handle?: TransformHandle,
  ) {
    // Middle-button and camera tools retain precedence even over a handle.
    if (e.button !== 0 || hand || space) return;
    e.stopPropagation();
    if (disabled || committing.current) return;
    const g = begin(e, false);
    g.picked = true;
    try {
      g.transform = createTransformGesture(project, selectedIds, {
        tool,
        handle,
        pointer: world(g.from, g.view),
      });
      g.rotation = g.transform.rotationState;
      setGestureFrame(g.transform.frame);
    } catch {
      cancel();
      setError(t("Этот слой нельзя преобразовать на холсте."));
    }
  }
  let frame: TransformFrame | null = null;
  if (!disabled && !commitBusy && selectedIds.length) {
    try {
      frame = getTransformFrame(project, selectedIds);
    } catch {
      /* Locked or non-scene selection. */
    }
  }
  function guideCurrent(g: GuideGesture) {
    const c = latest.current;
    return (
      guideGesture.current === g &&
      g.token === lifetime.current &&
      c.project.projectId === g.projectId &&
      c.pageId === g.pageId &&
      c.project.revision === g.revision &&
      c.view === g.view &&
      c.size === g.size &&
      c.locale === g.locale &&
      !c.disabled &&
      !committing.current
    );
  }
  useEffect(() => {
    const g = guideGesture.current;
    if (g && !guideCurrent(g)) {
      cancel();
      setError(t("Документ или контекст изменился. Направляющая отменена."));
    }
  }, [
    project.projectId,
    project.revision,
    page.screenId,
    view,
    size,
    locale,
    disabled,
    cancel,
    t,
  ]);
  function startGuide(
    e: PointerEvent<HTMLButtonElement>,
    axis: PageGuide["axis"],
    id?: string,
  ) {
    if (e.button !== 0 || hand || space || e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    e.preventDefault();
    if (disabled || committing.current) return;
    const existing = id
      ? page.guides?.find((guide) => guide.id === id)
      : undefined;
    if (existing?.locked) return;
    if (!existing && (page.guides?.length ?? 0) >= GUIDE_LIMITS.count) {
      setError(
        t("Достигнут лимит направляющих: {count}.", {
          count: GUIDE_LIMITS.count,
        }),
      );
      return;
    }
    cancel();
    setError("");
    surface.current?.focus({ preventScroll: true });
    surface.current?.setPointerCapture(e.pointerId);
    const from = point(e),
      coordinate = world(from, view)[axis];
    const guide = existing ?? {
      id: crypto.randomUUID(),
      axis,
      position: coordinate,
    };
    const g: GuideGesture = {
      pointer: e.pointerId,
      projectId: project.projectId,
      pageId: page.screenId,
      revision: project.revision,
      view,
      size,
      locale,
      guide,
      isNew: !existing,
      from,
      last: from,
      position: guide.position,
      token: ++lifetime.current,
    };
    guideGesture.current = g;
    setGuidePreview({ ...guide });
  }
  function updateGuidePointer(e: PointerEvent, final: boolean) {
    const g = guideGesture.current;
    if (!g || g.pointer !== e.pointerId) return false;
    if (!guideCurrent(g)) {
      cancel();
      return true;
    }
    g.last = point(e);
    const coordinate = world(g.last, g.view)[g.guide.axis],
      origin = world(g.from, g.view)[g.guide.axis];
    const position = g.isNew
      ? coordinate
      : g.guide.position + coordinate - origin;
    g.position = position;
    if (final) {
      const inset = rulers ? RULER_THICKNESS : 0;
      const inside =
        g.last.x >= inset &&
        g.last.y >= inset &&
        g.last.x <= g.size.width &&
        g.last.y <= g.size.height;
      const valid =
        Number.isFinite(position) &&
        Math.abs(position) <= GUIDE_LIMITS.position;
      const changed = g.isNew || Math.abs(position - g.guide.position) > 1e-9;
      const moved = Math.hypot(g.last.x - g.from.x, g.last.y - g.from.y) >= 3;
      cancel();
      if (!inside || !valid || !changed || !moved) return true;
      committing.current = true;
      setCommitBusy(true);
      const operation: Operation = g.isNew
        ? {
            type: "addGuide",
            pageId: g.pageId,
            guide: { ...g.guide, position },
          }
        : {
            type: "moveGuide",
            pageId: g.pageId,
            guideId: g.guide.id,
            position,
          };
      void latest.current
        .mutate(
          [operation],
          t(g.isNew ? "Создать направляющую" : "Переместить направляющую"),
          g.revision,
        )
        .catch((error) => setError(error.message))
        .finally(() => {
          committing.current = false;
          setCommitBusy(false);
        });
    } else if (guideRaf.current === null)
      guideRaf.current = requestAnimationFrame(() => {
        guideRaf.current = null;
        if (guideCurrent(g))
          setGuidePreview({ ...g.guide, position: g.position });
      });
    return true;
  }
  function guideKey(
    e: import("react").KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) {
    const guide = page.guides?.find((guide) => guide.id === id);
    if (!guide) return;
    if (e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      setSpace(true);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      onManageGuides?.();
      return;
    }
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Delete",
        "Backspace",
      ].includes(e.key)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    if (disabled || guide.locked || committing.current) return;
    const delta =
      guide.axis === "x"
        ? e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowRight"
            ? 1
            : 0
        : e.key === "ArrowUp"
          ? -1
          : e.key === "ArrowDown"
            ? 1
            : 0;
    if (!delta && e.key !== "Delete" && e.key !== "Backspace") return;
    const operation: Operation = delta
      ? {
          type: "moveGuide",
          pageId: page.screenId,
          guideId: id,
          position: guide.position + delta * (e.shiftKey ? 10 : 1),
        }
      : { type: "removeGuide", pageId: page.screenId, guideId: id };
    committing.current = true;
    setCommitBusy(true);
    void mutate(
      [operation],
      t(delta ? "Переместить направляющую" : "Удалить направляющую"),
      project.revision,
    )
      .catch((error) => setError(error.message))
      .finally(() => {
        committing.current = false;
        setCommitBusy(false);
      });
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
          aria-label={t("Изменение размера")}
          aria-pressed={!hand && mode === "resize"}
          onClick={() => {
            cancel();
            setHand(false);
            setMode("resize");
          }}
        >
          <CanvasIcon path="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M4 4l6 6M20 20l-6-6" />
        </button>
        <button
          type="button"
          aria-label={t("Масштабирование содержимого")}
          aria-pressed={!hand && mode === "scale"}
          onClick={() => {
            cancel();
            setHand(false);
            setMode("scale");
          }}
        >
          <CanvasIcon path="M4 14v6h6M14 4h6v6M20 4l-8 8M4 20l8-8" />
        </button>
        {onOpenTransformControls && (
          <button
            type="button"
            aria-label={t("Числовые параметры преобразования")}
            onClick={onOpenTransformControls}
          >
            <CanvasIcon path="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" />
          </button>
        )}
        <button
          type="button"
          aria-label={t("Рука: перемещение холста")}
          aria-pressed={hand}
          onClick={() => {
            cancel();
            setHand((v) => !v);
          }}
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
        <button
          type="button"
          aria-label={t("Умные привязки")}
          title={t("Умные привязки · Ctrl/⌘ временно отключает")}
          aria-pressed={snapEnabled}
          onClick={() => {
            cancel();
            setSnapEnabled((value) => !value);
          }}
        >
          <CanvasIcon path="M6 3v9a6 6 0 0012 0V3h-4v9a2 2 0 01-4 0V3zM6 7h4M14 7h4" />
        </button>
        <button
          type="button"
          aria-label={t("Линейки")}
          aria-pressed={rulers}
          onClick={() => {
            cancel();
            setRulers((value) => !value);
          }}
        >
          <CanvasIcon path="M3 6h18v12H3zM7 6v4M11 6v6M15 6v4" />
        </button>
        <button
          type="button"
          aria-label={t("Показать направляющие")}
          aria-pressed={guidesVisible}
          onClick={() => {
            cancel();
            setGuidesVisible((value) => !value);
          }}
        >
          <CanvasIcon path="M8 2v20M2 8h20M3 3h3M18 3h3M3 18v3" />
        </button>
        <button
          type="button"
          aria-label={t("Направляющие")}
          onClick={() => {
            cancel();
            onManageGuides?.();
          }}
        >
          <CanvasIcon path="M4 8h16M4 16h16M8 4v16M16 4v16" />
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
          if (updateGuidePointer(e, false)) return;
          const g = gesture.current;
          if (g && g.pointer === e.pointerId) {
            g.last = point(e);
            g.shiftKey = e.shiftKey;
            g.altKey = e.altKey;
            g.ctrlKey = e.ctrlKey;
            g.metaKey = e.metaKey;
            move(g);
          }
        }}
        onPointerUp={(e) => {
          if (updateGuidePointer(e, true)) return;
          const g = gesture.current;
          if (g && g.pointer === e.pointerId) {
            g.last = point(e);
            g.shiftKey = e.shiftKey;
            g.altKey = e.altKey;
            g.ctrlKey = e.ctrlKey;
            g.metaKey = e.metaKey;
            g.ended = true;
            finish(g);
          }
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (
            (gesture.current && !gesture.current.ended) ||
            guideGesture.current
          )
            cancel();
        }}
        onKeyDown={(e) => {
          if (
            e.nativeEvent.isComposing ||
            (e.target instanceof HTMLElement &&
              e.target.closest(
                "input,textarea,select,button,a,[contenteditable=true]",
              ))
          )
            return;
          const active = gesture.current;
          if (
            active &&
            !active.pan &&
            ["Control", "Meta", "Shift", "Alt"].includes(e.key)
          ) {
            active.ctrlKey = e.ctrlKey;
            active.metaKey = e.metaKey;
            active.shiftKey = e.shiftKey;
            active.altKey = e.altKey;
            move(active);
          }
          const toolKey =
            e.code === "KeyV"
              ? "v"
              : e.code === "KeyK"
                ? "k"
                : e.key.toLowerCase();
          if (
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            (toolKey === "v" || toolKey === "k")
          ) {
            e.preventDefault();
            if (!e.repeat) {
              const nextMode = toolKey === "k" ? "scale" : "resize";
              const pending = gesture.current;
              // Complete an already released click before changing tools; it
              // cannot write geometry. Active drags still cancel immediately.
              if (
                pending &&
                !pending.pan &&
                pending.ended &&
                !pending.picked &&
                Math.hypot(
                  pending.last.x - pending.from.x,
                  pending.last.y - pending.from.y,
                ) < 3
              ) {
                pending.modeAfterPick = nextMode;
              } else {
                cancel();
                setHand(false);
                setMode(nextMode);
              }
            }
          }
          if (e.key === " ") {
            e.preventDefault();
            if (!e.repeat) {
              cancel();
              setSpace(true);
            }
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
          const active = gesture.current;
          if (
            active &&
            !active.pan &&
            ["Control", "Meta", "Shift", "Alt"].includes(e.key)
          ) {
            active.ctrlKey = e.ctrlKey;
            active.metaKey = e.metaKey;
            active.shiftKey = e.shiftKey;
            active.altKey = e.altKey;
            move(active);
          }
          if (e.key === " ") setSpace(false);
        }}
        onBlur={(e) => {
          if (
            e.relatedTarget instanceof Node &&
            e.currentTarget.contains(e.relatedTarget)
          )
            return;
          setSpace(false);
          if (gesture.current || guideGesture.current) cancel();
        }}
      >
        <div className="canvas-frame">
          <Preview
            library={library}
            project={project}
            theme={project.theme}
            title={t("Холст ") + page.name}
            height={size.height}
            nodes={page.nodes}
            canvas={{ surfaceId, epoch, view, geometry, pick }}
            onGeometry={receiveGeometry}
            onPick={receivePick}
          />
        </div>
        <div className="canvas-capture" />
        {geometryEpoch === epoch &&
          bounds
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
            ))}{" "}
        <SnapOverlay view={view} lines={snapLines} />
        {guidesVisible && (
          <CanvasGuideOverlay
            view={view}
            size={size}
            guides={
              guidePreview &&
              !page.guides?.some((g) => g.id === guidePreview.id)
                ? [...(page.guides ?? []), guidePreview]
                : (page.guides ?? [])
            }
            transientPositions={
              guidePreview
                ? new Map([[guidePreview.id, guidePreview.position]])
                : undefined
            }
            disabled={disabled || commitBusy}
            onGuidePointerDown={(event, id) => {
              const guide = page.guides?.find((guide) => guide.id === id);
              if (guide) startGuide(event, guide.axis, id);
            }}
            onGuideKeyDown={guideKey}
          />
        )}
        {rulers && (
          <CanvasRulers
            view={view}
            size={size}
            disabled={disabled || commitBusy}
            onGuideCreateStart={(event, axis) => startGuide(event, axis)}
            onGuideCreate={(axis) => {
              cancel();
              onManageGuides?.({
                axis,
                position: world(
                  { x: size.width / 2, y: size.height / 2 },
                  view,
                )[axis],
              });
            }}
            onManageGuides={() => {
              cancel();
              onManageGuides?.();
            }}
          />
        )}
        {!hand && !space && (gestureFrame ?? frame) && (
          <TransformHandles
            frame={(gestureFrame ?? frame)!}
            view={view}
            mode={mode}
            disabled={disabled || commitBusy}
            onStart={startHandle}
          />
        )}
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
