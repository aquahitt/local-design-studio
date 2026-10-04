import { useEffect, useState } from "react";
import { libraries } from "virtual:studio-libraries";
import {
  ComponentView,
  Nodes,
  RenderBoundary,
  type PreviewInput,
} from "./Preview";
import { resolveTokens } from "../core/tokens";
import type { Project } from "../core/project";
type Input = Omit<PreviewInput, "library" | "onSelect"> & {
  library: { id: string; version: string };
};
export function PreviewApp() {
  const [input, setInput] = useState<Input | null>(null);
  useEffect(() => {
    const ready = () =>
      parent.postMessage(
        { type: "studio-preview-ready" },
        __STUDIO_DESKTOP__ ? "studio://app" : location.origin,
      );
    function receive(event: MessageEvent) {
      if (
        event.origin !==
          (__STUDIO_DESKTOP__ ? "studio://app" : location.origin) ||
        event.source !== parent
      )
        return;
      if (event.data?.type === "studio-preview-ping") ready();
      if (event.data?.type === "studio-preview-render") setInput(event.data);
    }
    window.addEventListener("message", receive);
    ready();
    return () => window.removeEventListener("message", receive);
  }, []);
  const library = libraries.find(
    (l) => l.id === input?.library.id && l.version === input?.library.version,
  );
  useEffect(() => {
    if (!input || !library) return;
    const mode = library.themes.find((t) => t.id === input.theme);
    document.documentElement.className = mode?.className ?? "";
    for (const a of Array.from(document.documentElement.attributes))
      if (a.name.startsWith("data-"))
        document.documentElement.removeAttribute(a.name);
    for (const [key, value] of Object.entries(mode?.attributes ?? {}))
      document.documentElement.setAttribute(key, value);
    document.body.style.cssText =
      "margin:0;padding:20px;min-height:100vh;box-sizing:border-box;background:var(--bg,#fff);color:var(--text-primary,#17202c);font-family:system-ui,sans-serif";
    for (const t of library.tokens)
      document.body.style.setProperty(
        t.name,
        t.themes?.[input.theme] ?? t.value,
      );
    for (const [name, value] of Object.entries(
      resolveTokens(input.project.tokens, input.theme),
    ))
      document.body.style.setProperty(
        name.startsWith("--") ? name : "--" + name,
        String(value),
      );
  }, [input, library]);
  if (!input) return null;
  if (!library) return <p>Библиотека недоступна</p>;
  const project = { ...input.project, theme: input.theme } as Project;
  const definition =
    input.component && library.components[input.component.type];
  return (
    <RenderBoundary
      resetKey={String(project.revision) + JSON.stringify(input.component)}
    >
      {input.component && definition ? (
        <ComponentView
          definition={definition}
          props={input.component.props}
          project={project}
        />
      ) : (
        <Nodes
          nodes={input.nodes ?? []}
          library={library}
          project={project}
          selected={input.selected ?? null}
          onSelect={(id) =>
            parent.postMessage(
              { type: "studio-preview-select", id },
              __STUDIO_DESKTOP__ ? "studio://app" : location.origin,
            )
          }
        />
      )}
    </RenderBoundary>
  );
}
