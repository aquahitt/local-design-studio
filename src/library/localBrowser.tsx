import { createElement, useEffect, useState, type ComponentType } from "react";
import { localDefaults } from "./localCatalog";
import type { ComponentLibrary, LibraryMetadata, Props } from "./sdk";
// All runtime imports are injected by the operator-configured Vite plugin.
// Documents never supply module paths, executable values, or callbacks.
export function createLocalLibrary(
  modules: Record<string, ComponentType<Record<string, unknown>>>,
  metadata: LibraryMetadata,
): ComponentLibrary {
  const components: ComponentLibrary["components"] = {};
  for (const [name, descriptor] of Object.entries(metadata.components)) {
    const Component = modules[name];
    const Renderer = (input: Props) => {
      const initial = { ...descriptor.defaultProps, ...input };
      const [value, setValue] = useState<unknown>(initial.value);
      const [checked, setChecked] = useState(Boolean(initial.checked));
      const [open, setOpen] = useState(false);
      useEffect(() => {
        setValue(initial.value);
        setChecked(Boolean(initial.checked));
      }, [input.value, input.checked]);
      if (!Component)
        return (
          <div role="note">
            {name}: {descriptor.description}
          </div>
        );
      const props: Record<string, unknown> = { ...initial };
      const noop = () => {};
      for (const key of [
        "onClose",
        "onBack",
        "onDismiss",
        "onEscape",
        "onConfirm",
        "onCancel",
        "onPrev",
        "onNext",
      ])
        props[key] = () => setOpen(false);
      props.onChange = (next: unknown) => {
        if (name === "Checkbox") setChecked(Boolean(next));
        else setValue(next);
      };
      props.onValueChange = setValue;
      if ("value" in initial) props.value = value;
      if ("checked" in initial) props.checked = checked;
      const viewer = {
        viewer: "Просмотр",
        close: "Закрыть",
        prev: "Предыдущее",
        next: "Следующее",
        openImage: (i: number) => `Открыть фото ${i + 1}`,
        imageAlt: (_label: string, i: number) => `Синтетическое фото ${i + 1}`,
        frame: (i: number) => `Кадр ${i + 1}`,
      };
      if (name === "ImageCarousel" || name === "ImageLightbox")
        props.labels = { ...viewer, ...(initial.labels as object) };
      if (name === "BuildingGallery")
        props.labels = { ...(initial.labels as object), viewer };
      if (name === "ObjectHistoryTimeline") {
        props.labels = {
          ...(initial.labels as object),
          field: (v: string) => v,
          status: (v: string) => v,
          source: (v: string) => v,
        };
        props.formatDate = (v: string) => v.slice(0, 10);
        props.formatDateTime = (v: string) => v.replace("T", " ").slice(0, 16);
      }
      if (name === "MarkdownEditor")
        props.labels = {
          ...(initial.labels as object),
          limitHint: (n: number) => `До ${n} символов`,
        };
      if (name === "Tabs" || /^Tabs(List|Trigger|Content)$/.test(name)) {
        const Tabs = modules.Tabs,
          List = modules.TabsList,
          Trigger = modules.TabsTrigger,
          Content = modules.TabsContent;
        if (Tabs && List && Trigger && Content) {
          const items = Array.isArray(initial.tabs)
            ? initial.tabs
            : localDefaults.Tabs.tabs;
          const tabs = (Array.isArray(items) ? items : []).filter(
            (
              item,
            ): item is { value: string; label: string; content?: string } =>
              item !== null &&
              typeof item === "object" &&
              !Array.isArray(item) &&
              typeof item.value === "string" &&
              typeof item.label === "string" &&
              (item.content === undefined || typeof item.content === "string"),
          );
          const selected = tabs.some((tab) => tab.value === value)
            ? value
            : (tabs[0]?.value ?? "");
          return createElement(
            Tabs,
            {
              value: selected,
              onValueChange: setValue,
              variant: initial.variant ?? "underline",
              size: initial.size ?? "md",
              activationMode: initial.activationMode ?? "automatic",
              className: initial.className,
            },
            createElement(
              List,
              {},
              ...tabs.map((tab) =>
                createElement(
                  Trigger,
                  {
                    key: tab.value,
                    value: tab.value,
                    className: initial.triggerClassName,
                  },
                  tab.label,
                ),
              ),
            ),
            ...tabs.map((tab) =>
              createElement(
                Content,
                { key: tab.value, value: tab.value },
                tab.content ?? "",
              ),
            ),
          );
        }
      }
      if (name === "SheetScrollHead" && modules.Sheet)
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Открыть заголовок листа
            </button>
            {open &&
              createElement(
                modules.Sheet,
                {
                  title: "Детали",
                  dismissLabel: "Закрыть",
                  onClose: () => setOpen(false),
                },
                createElement(Component, props),
              )}
          </>
        );
      if (name === "OverflowActions")
        props.children = [
          createElement(
            "button",
            { "aria-label": "Поделиться", onClick: noop, key: "share" },
            "Поделиться",
          ),
          createElement(
            "button",
            { "aria-label": "Сохранить", onClick: noop, key: "save" },
            "Сохранить",
          ),
        ];
      if (/^(Modal|Sheet|GameModal|FullscreenLayer|ImageLightbox)$/.test(name))
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Открыть {name}
            </button>
            {open && createElement(Component, props)}
          </>
        );
      return createElement(Component, props);
    };
    components[name] = { ...descriptor, render: Renderer };
  }
  return { ...metadata, components };
}
