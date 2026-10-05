import {
  Component,
  useEffect,
  useRef,
  useState,
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
      <div role="alert" className="render-error">
        Компонент требует контекст: {this.state.error}
      </div>
    ) : (
      this.props.children
    );
  }
}
export interface PreviewInput {
  project: Project;
  library: ComponentLibrary;
  theme: string;
  title: string;
  height?: number;
  autoHeight?: boolean;
  component?: { type: string; props: Props };
  nodes?: ProjectNode[];
  selected?: string | null;
  onSelect?: (id: string) => void;
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
  onSelect,
}: PreviewInput) {
  const ref = useRef<HTMLIFrameElement>(null);
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
          Math.max(120, Math.min(600, Math.ceil(event.data.height))),
        );
      if (
        event.data?.type === "studio-preview-select" &&
        typeof event.data.id === "string"
      )
        onSelect?.(event.data.id);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onSelect, autoHeight]);
  useEffect(() => {
    if (ready)
      ref.current?.contentWindow?.postMessage(
        {
          type: "studio-preview-render",
          project,
          library: { id: library.id, version: library.version },
          theme,
          component,
          autoHeight,
          nodes,
          selected,
        },
        __STUDIO_DESKTOP__ ? "studio://preview" : location.origin,
      );
  }, [ready, project, library, theme, component, autoHeight, nodes, selected]);
  return (
    <iframe
      ref={ref}
      title={title}
      src={
        __STUDIO_DESKTOP__
          ? "studio://preview/preview"
          : __STUDIO_DEMO__
            ? import.meta.env.BASE_URL + "index.html?preview=1"
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
        width: "100%",
        border: 0,
        display: "block",
        background: "#fff",
      }}
    />
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
  onSelect,
}: {
  nodes: ProjectNode[];
  library: ComponentLibrary;
  project: Project;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const definition =
          library.id === project.library.id &&
          library.version === project.library.version
            ? library.components[node.type]
            : undefined;
        return (
          <div
            key={node.id}
            data-node-id={node.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(node.id);
            }}
            style={
              {
                position: "relative",
                padding: 8,
                outline:
                  node.id === selected
                    ? "2px solid #4673e8"
                    : "1px dashed #ddd",
                borderRadius: 6,
                marginBottom: 12,
              } as CSSProperties
            }
          >
            {definition ? (
              <RenderBoundary resetKey={node.type + JSON.stringify(node.props)}>
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
                              library,
                              project,
                              selected,
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
                Недоступен {node.type} · исходные данные сохранены
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
