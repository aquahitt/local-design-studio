import { I18nProvider, translate } from "./i18n";
import { observePreviewSize } from "./previewSizing";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import { useEffect, useRef, useState } from "react";
import { loadDesktopLibrary } from "./desktopLibraries";
import type { DesktopLibrary } from "../desktop/types";
import type { ComponentLibrary } from "../library/sdk";
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
  desktopLibrary?: DesktopLibrary;
};
if (__STUDIO_DESKTOP__)
  Object.assign(globalThis, {
    __studioRuntime: {
      react: React,
      reactDOM: ReactDOM,
      jsxRuntime,
      jsxDevRuntime,
    },
  });
export function PreviewApp() {
  const content = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<Input | null>(null);
  const [external, setExternal] = useState<ComponentLibrary | null>(null);
  const [externalError, setExternalError] = useState("");
  useEffect(() => {
    let active = true;
    setExternal(null);
    setExternalError("");
    if (__STUDIO_DESKTOP__ && input?.desktopLibrary)
      void loadDesktopLibrary(input.desktopLibrary)
        .then((value) => {
          if (active) setExternal(value);
        })
        .catch((error) => {
          if (active) setExternalError(error.message);
        });
    return () => {
      active = false;
    };
  }, [input?.desktopLibrary?.bundleUrl]);
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
    document.documentElement.dataset.studioPreviewListening = "true";
    ready();
    return () => {
      window.removeEventListener("message", receive);
      delete document.documentElement.dataset.studioPreviewListening;
    };
  }, []);
  const library = [...libraries, ...(external ? [external] : [])].find(
    (l) => l.id === input?.library.id && l.version === input?.library.version,
  );
  useEffect(() => {
    delete document.documentElement.dataset.studioPreviewRevision;
    if (!input || !library) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        document.documentElement.dataset.studioPreviewRevision = String(
          input.project.revision,
        );
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [input, library]);
  useEffect(() => {
    if (!input || !library) return;
    const mode = library.themes.find((t) => t.id === input.theme);
    document.documentElement.className = mode?.className ?? "";
    for (const a of Array.from(document.documentElement.attributes))
      if (
        a.name.startsWith("data-") &&
        !a.name.startsWith("data-studio-preview-")
      )
        document.documentElement.removeAttribute(a.name);
    for (const [key, value] of Object.entries(mode?.attributes ?? {}))
      if (!key.toLowerCase().startsWith("data-studio-preview-"))
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
  useEffect(() => {
    if (!input?.autoHeight || !input.component || !content.current) return;
    return observePreviewSize(content.current, (height, width) =>
      parent.postMessage(
        { type: "studio-preview-size", height, width },
        __STUDIO_DESKTOP__ ? "studio://app" : location.origin,
      ),
    );
  }, [input, library]);
  if (!input) return null;
  if (!library)
    return (
      <p role="status">
        {externalError ||
          (input.desktopLibrary
            ? translate(
                input.locale === "en" ? "en" : "ru",
                "Загружаем библиотеку…",
              )
            : translate(
                input.locale === "en" ? "en" : "ru",
                "Библиотека недоступна",
              ))}
      </p>
    );
  const project = { ...input.project, theme: input.theme } as Project;
  const definition =
    input.component && library.components[input.component.type];
  return (
    <I18nProvider locale={input.locale === "en" ? "en" : "ru"}>
      <div
        ref={content}
        style={{
          display: "flow-root",
          position: "relative",
          minHeight: input.nodes?.some((node) => node.scene)
            ? (input.project.pages.find((page) =>
                page.nodes.some((node) =>
                  input.nodes?.some((current) => current.id === node.id),
                ),
              )?.viewport.height ?? 850)
            : undefined,
        }}
      >
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
              selectedIds={input.selectedIds}
              onSelect={(id, additive) =>
                parent.postMessage(
                  { type: "studio-preview-select", id, additive },
                  __STUDIO_DESKTOP__ ? "studio://app" : location.origin,
                )
              }
            />
          )}
        </RenderBoundary>
      </div>
    </I18nProvider>
  );
}
