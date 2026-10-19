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
  const [pickRequest, setPickRequest] = useState<{
    surfaceId: string;
    epoch: number;
    revision: number;
    requestId: number;
    x: number;
    y: number;
  } | null>(null);
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
      if (event.data?.type === "studio-preview-pick") {
        const d = event.data;
        if (
          typeof d.surfaceId !== "string" ||
          !Number.isSafeInteger(d.epoch) ||
          !Number.isSafeInteger(d.revision) ||
          !Number.isSafeInteger(d.requestId) ||
          ![d.x, d.y].every(
            (v) => typeof v === "number" && Number.isFinite(v),
          ) ||
          d.x < 0 ||
          d.y < 0 ||
          d.x > innerWidth ||
          d.y > innerHeight
        )
          return;
        setPickRequest({
          surfaceId: d.surfaceId,
          epoch: d.epoch,
          revision: d.revision,
          requestId: d.requestId,
          x: d.x,
          y: d.y,
        });
      }
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
    document.documentElement.style.background = input.canvas
      ? "transparent"
      : "";
    for (const a of Array.from(document.documentElement.attributes))
      if (
        a.name.startsWith("data-") &&
        !a.name.startsWith("data-studio-preview-")
      )
        document.documentElement.removeAttribute(a.name);
    for (const [key, value] of Object.entries(mode?.attributes ?? {}))
      if (!key.toLowerCase().startsWith("data-studio-preview-"))
        document.documentElement.setAttribute(key, value);
    document.body.style.cssText = `margin:0;padding:${input.canvas ? 0 : 20}px;min-height:100vh;box-sizing:border-box;background:${input.canvas ? "transparent" : "var(--bg,#fff)"};color:var(--text-primary,#17202c);font-family:system-ui,sans-serif;${input.canvas ? "overflow:hidden" : ""}`;
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
  // Render and pick messages may arrive before React commits the newer surface.
  // Resolve only after the exact snapshot is in the DOM, rather than dropping or
  // hit-testing against a previous camera/drag state.
  useEffect(() => {
    const d = pickRequest;
    if (!d || !input?.canvas || !library) return;
    if (
      d.surfaceId !== input.canvas.surfaceId ||
      d.epoch < input.canvas.epoch
    ) {
      setPickRequest(null);
      return;
    }
    if (d.epoch !== input.canvas.epoch || d.revision !== input.project.revision)
      return;
    const element = document
      .elementFromPoint(d.x, d.y)
      ?.closest("[data-selection-id]");
    parent.postMessage(
      {
        type: "studio-preview-picked",
        surfaceId: d.surfaceId,
        epoch: d.epoch,
        revision: d.revision,
        requestId: d.requestId,
        id: element?.getAttribute("data-selection-id") ?? null,
      },
      __STUDIO_DESKTOP__ ? "studio://app" : location.origin,
    );
    setPickRequest(null);
  }, [input, library, pickRequest]);
  useEffect(() => {
    if (!input?.autoHeight || !input.component || !content.current) return;
    return observePreviewSize(content.current, (height, width) =>
      parent.postMessage(
        { type: "studio-preview-size", height, width },
        __STUDIO_DESKTOP__ ? "studio://app" : location.origin,
      ),
    );
  }, [input, library]);
  useEffect(() => {
    if (!input?.canvas || !library || !content.current) return;
    const surface = content.current;
    let frame = 0;
    const send = () => {
      const view = input.canvas!.view;
      const seen = new Set<string>();
      const bounds = Array.from(
        surface.querySelectorAll<HTMLElement>("[data-selection-id]"),
      ).flatMap((element) => {
        const id = element.dataset.selectionId!;
        if (seen.has(id)) return [];
        seen.add(id);
        const b = element.getBoundingClientRect();
        return [
          {
            id,
            x: (b.x - view.panX) / view.zoom,
            y: (b.y - view.panY) / view.zoom,
            width: b.width / view.zoom,
            height: b.height / view.zoom,
          },
        ];
      });
      parent.postMessage(
        {
          type: "studio-preview-geometry",
          surfaceId: input.canvas!.surfaceId,
          epoch: input.canvas!.epoch,
          revision: input.project.revision,
          bounds,
        },
        __STUDIO_DESKTOP__ ? "studio://app" : location.origin,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(send);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(surface);
    surface
      .querySelectorAll("[data-node-id]")
      .forEach((e) => observer.observe(e));
    schedule();
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
    };
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
          transform: input.canvas
            ? `translate(${input.canvas.view.panX}px,${input.canvas.view.panY}px) scale(${input.canvas.view.zoom})`
            : undefined,
          transformOrigin: "0 0",
          width: input.canvas
            ? input.project.pages.find((p) =>
                p.nodes.some((n) => input.nodes?.some((i) => i.id === n.id)),
              )?.viewport.width
            : undefined,
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
              positions={input.canvas?.positions}
              selected={input.canvas ? null : (input.selected ?? null)}
              selectedIds={input.canvas ? [] : input.selectedIds}
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
