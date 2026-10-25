import { compileTextStyle } from "../core/text-style";
import { validCanvasBounds, type CanvasBounds } from "./canvasCamera";
import type { SceneView } from "../core/scene";
import { layerStyle } from "../core/handoff";
import {
  withTransientGeometry,
  type SceneGeometryMap,
} from "./transientGeometry";
import { useI18n, type StudioLocale } from "./i18n";
import {
  Component,
  useEffect,
  useRef,
  useState,
  useContext,
  type ReactNode,
  type CSSProperties,
  type ComponentType,
} from "react";
import type {
  ComponentLibrary,
  ComponentDefinition,
  Props,
} from "../library/sdk";
import { resolveTokens } from "../core/tokens";
import type { Project, ProjectNode } from "../core/project";
import { DesktopLibraryContext } from "./desktopLibraryContext";
import { resolveSceneNodes, sceneSelectionId } from "../core/design-components";
export class RenderBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidUpdate(previous: { children: ReactNode; resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey)
      this.setState({ error: "" });
  }
  render() {
    return this.state.error ? (
      <RenderError message={this.state.error} />
    ) : (
      this.props.children
    );
  }
}
function RenderError({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="render-error">
      {t("Компонент требует контекст:")} {message}
    </div>
  );
}
export type CanvasPreview = {
  epoch: number;
  surfaceId: string;
  view: SceneView;
  geometry?: SceneGeometryMap;
  pick?: { requestId: number; x: number; y: number };
};
export interface PreviewInput {
  canvas?: CanvasPreview;
  onGeometry?: (
    bounds: CanvasBounds[],
    revision: number,
    epoch: number,
  ) => void;
  onPick?: (id: string | null, requestId: number) => void;
  locale?: StudioLocale;
  project: Project;
  library: ComponentLibrary;
  theme: string;
  title: string;
  height?: number;
  autoHeight?: boolean;
  component?: { type: string; props: Props };
  nodes?: ProjectNode[];
  selected?: string | null;
  selectedIds?: string[];
  onSelect?: (id: string, additive?: boolean) => void;
}
export function Preview({
  project,
  library,
  theme,
  title,
  height = 230,
  autoHeight = false,
  component,
  nodes,
  selected,
  selectedIds,
  onSelect,
  canvas,
  onGeometry,
  onPick,
}: PreviewInput) {
  const { locale, t } = useI18n();
  const desktopLibrary = useContext(DesktopLibraryContext);
  const ref = useRef<HTMLIFrameElement>(null);
  const live = useRef({
    canvas,
    revision: project.revision,
    projectId: project.projectId,
    fonts: project.fonts,
    nodes,
    onGeometry,
    onPick,
  });
  live.current = {
    canvas,
    revision: project.revision,
    projectId: project.projectId,
    fonts: project.fonts,
    nodes,
    onGeometry,
    onPick,
  };
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  useEffect(() => {
    if (!autoHeight || !container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(entry.contentRect.width),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [autoHeight]);
  useEffect(() => setContentWidth(0), [component?.type, theme]);
  const [ready, setReady] = useState(false);
  const [fontWarnings, setFontWarnings] = useState<string[]>([]);
  useEffect(
    () => setFontWarnings([]),
    [project.projectId, project.revision, nodes],
  );
  const [measuredHeight, setMeasuredHeight] = useState(height);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !==
          (__STUDIO_DESKTOP__ ? "studio://preview" : location.origin) ||
        event.source !== ref.current?.contentWindow
      )
        return;
      if (event.data?.type === "studio-preview-ready") setReady(true);
      if (
        event.data?.type === "studio-preview-font-status" &&
        event.data.projectId === live.current.projectId &&
        event.data.revision === live.current.revision &&
        Array.isArray(event.data.warnings) &&
        event.data.warnings.length <= 128 &&
        event.data.warnings.every(
          (warning: { code?: unknown; fontId?: unknown }) =>
            warning?.code === "PROJECT_FONT_UNAVAILABLE" &&
            typeof warning.fontId === "string" &&
            live.current.fonts?.some((font) => font.id === warning.fontId),
        )
      )
        setFontWarnings(
          event.data.warnings.map(
            (warning: { fontId: string }) => warning.fontId,
          ),
        );
      if (
        live.current.canvas &&
        event.data?.surfaceId === live.current.canvas.surfaceId &&
        event.data?.epoch === live.current.canvas.epoch &&
        event.data?.revision === live.current.revision
      ) {
        const allowed = new Set<string>();
        const walk = (rows: ProjectNode[]) =>
          rows.forEach((n) => {
            allowed.add(n.id);
            Object.values(n.slots).forEach(walk);
          });
        walk(live.current.nodes ?? []);
        if (
          event.data.type === "studio-preview-geometry" &&
          validCanvasBounds(event.data.bounds, allowed)
        )
          live.current.onGeometry?.(
            event.data.bounds,
            event.data.revision,
            event.data.epoch,
          );
        if (
          event.data.type === "studio-preview-picked" &&
          Number.isSafeInteger(event.data.requestId) &&
          (event.data.id === null || allowed.has(event.data.id))
        )
          live.current.onPick?.(event.data.id, event.data.requestId);
      }
      if (
        autoHeight &&
        event.data?.type === "studio-preview-size" &&
        typeof event.data.height === "number" &&
        Number.isFinite(event.data.height)
      )
        setMeasuredHeight(
          Math.max(120, Math.min(1600, Math.ceil(event.data.height))),
        );
      if (
        autoHeight &&
        event.data?.type === "studio-preview-size" &&
        typeof event.data.width === "number" &&
        Number.isFinite(event.data.width)
      )
        setContentWidth((previous) =>
          Math.max(previous, Math.min(1600, Math.ceil(event.data.width))),
        );
      if (
        event.data?.type === "studio-preview-select" &&
        typeof event.data.id === "string"
      )
        onSelect?.(event.data.id, event.data.additive === true);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [
    onSelect,
    autoHeight,
    canvas?.surfaceId,
    project.revision,
    nodes,
    onGeometry,
    onPick,
  ]);
  useEffect(() => {
    if (ready)
      ref.current?.contentWindow?.postMessage(
        {
          type: "studio-preview-render",
          locale,
          project,
          library: { id: library.id, version: library.version },
          theme,
          component,
          autoHeight,
          nodes,
          selected,
          selectedIds,
          desktopLibrary,
          canvas: canvas
            ? {
                surfaceId: canvas.surfaceId,
                epoch: canvas.epoch,
                view: canvas.view,
                geometry: canvas.geometry,
              }
            : undefined,
        },
        __STUDIO_DESKTOP__ ? "studio://preview" : location.origin,
      );
  }, [
    ready,
    project,
    library,
    theme,
    component,
    autoHeight,
    nodes,
    selected,
    selectedIds,
    desktopLibrary,
    locale,
    canvas?.surfaceId,
    canvas?.view,
    canvas?.geometry,
    canvas?.epoch,
  ]);
  useEffect(() => {
    if (ready && canvas?.pick)
      ref.current?.contentWindow?.postMessage(
        {
          type: "studio-preview-pick",
          surfaceId: canvas.surfaceId,
          epoch: canvas.epoch,
          revision: project.revision,
          ...canvas.pick,
        },
        __STUDIO_DESKTOP__ ? "studio://preview" : location.origin,
      );
  }, [ready, canvas?.pick, canvas?.surfaceId, project.revision]);
  const renderWidth = Math.max(availableWidth, contentWidth);
  const scale =
    autoHeight && availableWidth && renderWidth
      ? Math.min(1, availableWidth / renderWidth)
      : 1;
  const frame = (
    <iframe
      ref={ref}
      title={title}
      tabIndex={canvas ? -1 : undefined}
      aria-hidden={canvas ? true : undefined}
      src={
        __STUDIO_DESKTOP__
          ? "studio://preview/preview"
          : __STUDIO_DEMO__
            ? import.meta.env.BASE_URL +
              "index.html?preview=1&renderer=" +
              encodeURIComponent(import.meta.url)
            : import.meta.env.BASE_URL + "preview"
      }
      loading={component ? "lazy" : "eager"}
      onLoad={() =>
        ref.current?.contentWindow?.postMessage(
          { type: "studio-preview-ping" },
          __STUDIO_DESKTOP__ ? "studio://preview" : location.origin,
        )
      }
      style={{
        height: autoHeight ? measuredHeight : height,
        width: autoHeight && renderWidth ? renderWidth : "100%",
        transform: scale < 1 ? `scale(${scale})` : undefined,
        transformOrigin: "top left",
        border: 0,
        display: "block",
        background: canvas ? "transparent" : "#fff",
        colorScheme: canvas ? "normal" : undefined,
      }}
    />
  );
  const warning = fontWarnings.length ? (
    <p role="status" className="preview-font-warning">
      {t("Не удалось загрузить шрифт проекта. Текст может отличаться:")}{" "}
      {fontWarnings
        .map((id) => {
          const font = project.fonts?.find((font) => font.id === id);
          return font ? `${font.name} · ${font.weight} ${font.style}` : id;
        })
        .join(", ")}
    </p>
  ) : null;
  return (
    <div className="studio-preview-ui">
      {warning}
      {autoHeight ? (
        <div
          ref={container}
          style={{
            width: "100%",
            height: measuredHeight * scale,
            overflow: "hidden",
          }}
        >
          {frame}
        </div>
      ) : (
        frame
      )}
    </div>
  );
}
export function resolveProps(props: Props, project: Project): Props {
  const tokens = resolveTokens(project.tokens, project.theme);
  const visit = (v: unknown): unknown =>
    v && typeof v === "object"
      ? "$token" in v
        ? tokens[String((v as { $token: string }).$token)]
        : Array.isArray(v)
          ? v.map(visit)
          : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]))
      : v;
  return visit(props) as Props;
}
export function ComponentView({
  definition,
  props,
  project,
  children,
}: {
  definition: ComponentDefinition;
  props: Props;
  project: Project;
  children?: ReactNode;
}) {
  const Renderer = definition.render as ComponentType<Record<string, unknown>>;
  return (
    <Renderer
      {...resolveProps({ ...definition.defaultProps, ...props }, project)}
      {...(children ? { children } : {})}
    />
  );
}
export function Nodes({
  nodes,
  library,
  project,
  selected,
  selectedIds = [],
  onSelect,
  inheritedLocked = false,
  materializedNodes = false,
  geometry = {},
}: {
  nodes: ProjectNode[];
  library: ComponentLibrary;
  project: Project;
  selected: string | null;
  selectedIds?: string[];
  onSelect: (id: string, additive?: boolean) => void;
  inheritedLocked?: boolean;
  materializedNodes?: boolean;
  geometry?: SceneGeometryMap;
}) {
  const { t } = useI18n();
  const hasInstance = (rows: ProjectNode[]): boolean =>
    rows.some(
      (node) => node.instance || Object.values(node.slots).some(hasInstance),
    );
  const materialized =
    !materializedNodes && hasInstance(nodes)
      ? resolveSceneNodes(project, nodes)
      : nodes;
  return (
    <>
      {materialized
        .filter((node) => !node.hidden)
        .map((sourceNode) => {
          const node = withTransientGeometry(sourceNode, geometry);
          const definition =
            library.id === project.library.id &&
            library.version === project.library.version
              ? library.components[node.type]
              : undefined;
          const resolved =
            node.type === "StudioImage" || node.scene?.kind === "image"
              ? resolveProps(node.props as Props, project)
              : node.props;
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              data-selection-id={sceneSelectionId(node)}
              onClick={(e) => {
                e.stopPropagation();
                if (!node.locked && !inheritedLocked)
                  onSelect(
                    sceneSelectionId(node),
                    e.shiftKey || e.metaKey || e.ctrlKey,
                  );
              }}
              style={
                {
                  position: node.scene ? "absolute" : "relative",
                  padding: node.scene ? 0 : 8,
                  ...(node.scene ? layerStyle(node) : {}),
                  outline:
                    node.id === selected || selectedIds.includes(node.id)
                      ? "2px solid #4673e8"
                      : node.scene
                        ? undefined
                        : "1px dashed #ddd",
                  ...(node.scene ? {} : { borderRadius: 6, marginBottom: 12 }),
                } as CSSProperties
              }
            >
              {node.scene?.kind === "text" ? (
                <div
                  style={compileTextStyle(node.scene, project) as CSSProperties}
                  dir={node.scene.textStyle?.direction}
                >
                  {String(
                    resolveProps(node.props as Props, project).text ?? "",
                  )}
                </div>
              ) : node.scene?.kind === "vector" ? (
                <svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${node.scene.width} ${node.scene.height}`}
                >
                  <path
                    d={node.scene.path ?? ""}
                    fill={node.scene.fill ?? "none"}
                    stroke={node.scene.stroke}
                    strokeWidth={node.scene.strokeWidth ?? 1}
                  />
                </svg>
              ) : node.type === "StudioImage" ||
                node.scene?.kind === "image" ? (
                <img
                  src={String(resolved.src ?? "")}
                  alt={String(resolved.alt ?? "")}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit:
                      resolved.objectFit === "cover" ? "cover" : "contain",
                    objectPosition: String(
                      resolved.objectPosition ?? "50% 50%",
                    ),
                  }}
                />
              ) : node.scene?.kind === "frame" || node.type === "SceneFrame" ? (
                Object.entries(node.slots).map(([slot, children]) => (
                  <Nodes
                    key={slot}
                    {...{
                      nodes: children,
                      inheritedLocked: inheritedLocked || !!node.locked,
                      materializedNodes: true,
                      geometry,
                      library,
                      project,
                      selected,
                      selectedIds,
                      onSelect,
                    }}
                  />
                ))
              ) : definition ? (
                <RenderBoundary
                  resetKey={node.type + JSON.stringify(node.props)}
                >
                  <ComponentView
                    definition={definition}
                    props={node.props as Props}
                    project={project}
                  >
                    {Object.keys(node.slots).length
                      ? Object.entries(node.slots).map(([slot, children]) => (
                          <div key={slot} data-slot={slot}>
                            <Nodes
                              {...{
                                nodes: children,
                                inheritedLocked:
                                  inheritedLocked || !!node.locked,
                                materializedNodes: true,
                                geometry,
                                library,
                                project,
                                selected,
                                selectedIds,
                                onSelect,
                              }}
                            />
                          </div>
                        ))
                      : undefined}
                  </ComponentView>
                </RenderBoundary>
              ) : (
                <div role="status">
                  {t("Недоступен")} {node.type}{" "}
                  {t("· исходные данные сохранены")}
                </div>
              )}
            </div>
          );
        })}
    </>
  );
}
