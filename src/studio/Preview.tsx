import { layerStyle } from "../core/handoff";
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
export interface PreviewInput {
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
}: PreviewInput) {
  const { locale } = useI18n();
  const desktopLibrary = useContext(DesktopLibraryContext);
  const ref = useRef<HTMLIFrameElement>(null);
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
  }, [onSelect, autoHeight]);
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
  ]);
  const renderWidth = Math.max(availableWidth, contentWidth);
  const scale =
    autoHeight && availableWidth && renderWidth
      ? Math.min(1, availableWidth / renderWidth)
      : 1;
  const frame = (
    <iframe
      ref={ref}
      title={title}
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
        background: "#fff",
      }}
    />
  );
  return autoHeight ? (
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
}: {
  nodes: ProjectNode[];
  library: ComponentLibrary;
  project: Project;
  selected: string | null;
  selectedIds?: string[];
  onSelect: (id: string, additive?: boolean) => void;
  inheritedLocked?: boolean;
  materializedNodes?: boolean;
}) {
  const { t } = useI18n();
  const hasInstance = (rows: ProjectNode[]): boolean => rows.some((node) => node.instance || Object.values(node.slots).some(hasInstance));
  const materialized = !materializedNodes && hasInstance(nodes)
    ? resolveSceneNodes(project, nodes)
    : nodes;
  return (
    <>
      {materialized
        .filter((node) => !node.hidden)
        .map((node) => {
          const definition =
            library.id === project.library.id &&
            library.version === project.library.version
              ? library.components[node.type]
              : undefined;
          const resolved = node.type === "StudioImage" || node.scene?.kind === "image" ? resolveProps(node.props as Props, project) : node.props;
          return (
            <div
              key={node.id}
              data-node-id={node.id}
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
                  style={{
                    fontSize: node.scene.fontSize ?? 16,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    lineHeight: 1.4,
                  }}
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
                                inheritedLocked: inheritedLocked || !!node.locked,
                                materializedNodes: true,
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
