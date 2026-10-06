import {
  createContext,
  createElement,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createLocalLibrary } from "./localBrowser";
import { createLocalMetadata } from "./localCatalog";
import type { Props } from "./sdk";

const selection = createContext("");
const modules = {
  Tabs: ({
    value,
    children,
    size,
    variant,
    activationMode,
    className,
  }: Record<string, unknown>) => (
    <selection.Provider value={value as string}>
      <div
        className={className as string}
        data-size={size}
        data-variant={variant}
        data-activation={activationMode}
      >
        {children as ReactNode}
      </div>
    </selection.Provider>
  ),
  TabsList: ({ children }: Record<string, unknown>) => (
    <div role="tablist">{children as ReactNode}</div>
  ),
  TabsTrigger: ({ value, children, className }: Record<string, unknown>) => (
    <button
      role="tab"
      className={className as string}
      aria-selected={useContext(selection) === value}
    >
      {children as ReactNode}
    </button>
  ),
  TabsContent: ({ value, children }: Record<string, unknown>) =>
    useContext(selection) === value ? (
      <div role="tabpanel">{children as ReactNode}</div>
    ) : null,
} as Record<string, ComponentType<Record<string, unknown>>>;
function metadata() {
  return createLocalMetadata({
    version: "1",
    exports: Object.keys(modules).map((name) => ({ name, kind: "component" })),
    fields: {
      Tabs: {
        children: { type: "string" },
        className: { type: "string" },
        activationMode: { type: "select", options: ["automatic", "manual"] },
        ignored: { type: "string" },
      },
    },
    tokens: [],
  });
}
function render(props: Props = {}) {
  return renderToStaticMarkup(
    createElement(
      createLocalLibrary(modules, metadata()).components.Tabs.render,
      props,
    ),
  );
}

describe("composed local Tabs preview", () => {
  it("forwards size, root classes, activation mode, and trigger classes", () => {
    const markup = render({
      size: "sm",
      variant: "pill",
      activationMode: "manual",
      className: "root-layout",
      triggerClassName: "trigger-spacing",
    });
    expect(markup).toContain('data-size="sm"');
    expect(markup).toContain('data-variant="pill"');
    expect(markup).toContain('data-activation="manual"');
    expect(markup).toContain('class="root-layout"');
    expect(markup.match(/class="trigger-spacing"/g)).toHaveLength(2);
  });
  it("uses editable tab values, labels, and optional content", () => {
    const markup = render({
      value: "prices",
      tabs: [
        { value: "photos", label: "Фото" },
        { value: "prices", label: "Цены", content: "От 120 000" },
      ],
    });
    expect(markup).toContain('aria-selected="true">Цены');
    expect(markup).toContain('role="tabpanel">От 120 000');
    expect(markup).toContain("Фото");
    expect(markup).not.toContain("Обзор");
  });
  it("selects the first configured tab when the stored value is absent", () => {
    expect(
      render({
        tabs: [{ value: "photos", label: "Фото", content: "Галерея" }],
      }),
    ).toContain('role="tabpanel">Галерея');
  });
  it("renders an empty tab list and ignores malformed items safely", () => {
    expect(render({ tabs: [] })).not.toContain('role="tab"');
    expect(() =>
      render({ tabs: [null, "invalid", { value: "ok", label: "Valid" }] }),
    ).not.toThrow();
    expect(
      render({ tabs: [null, "invalid", { value: "ok", label: "Valid" }] }),
    ).toContain("Valid");
  });
  it("advertises only props supported by the composed renderer and includes editable fixtures", () => {
    const component = metadata().components.Tabs;
    expect(Object.keys(component.fields).sort()).toEqual(
      [
        "activationMode",
        "className",
        "size",
        "tabs",
        "triggerClassName",
        "value",
        "variant",
      ].sort(),
    );
    expect(component.fields.size).toEqual({
      type: "select",
      options: ["sm", "md"],
    });
    expect(component.fields.tabs.type).toBe("json");
    expect(component.defaultProps.tabs).toHaveLength(2);
    expect(
      component.fixtures.some(
        (fixture) =>
          fixture.props.size === "sm" && fixture.props.variant === "pill",
      ),
    ).toBe(true);
  });
});

it.skipIf(!process.env.STUDIO_LIBRARY_ROOT)(
  "actual local Tabs changes pill padding and renders configured labels/content",
  async () => {
    const { createServer } = await import("vite");
    const { studioLibraryPlugin } =
      await import("../../scripts/library/plugin");
    const server = await createServer({
      configFile: false,
      plugins: [
        studioLibraryPlugin({ externalRoot: process.env.STUDIO_LIBRARY_ROOT }),
      ],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    try {
      const { libraries } = await server.ssrLoadModule(
        "virtual:studio-libraries",
      );
      const component = libraries.find(
        (library: { id: string }) => library.id === "stroi-ui",
      ).components.Tabs;
      const props = {
        variant: "pill",
        value: "custom",
        tabs: [
          { value: "custom", label: "Custom label", content: "Custom content" },
        ],
        className: "root-layout",
        triggerClassName: "trigger-spacing",
      };
      const small = renderToStaticMarkup(
        createElement(component.render, { ...props, size: "sm" }),
      );
      const medium = renderToStaticMarkup(
        createElement(component.render, { ...props, size: "md" }),
      );
      expect(small).toContain("py-1.5");
      expect(medium).toContain("py-2");
      expect(small).not.toContain("py-2 ");
      expect(small).toContain("Custom label");
      expect(small).toContain("Custom content");
      expect(small).toContain("root-layout");
      expect(small).toContain("trigger-spacing");
      expect(small).toContain('role="tabpanel"');
    } finally {
      await server.close();
    }
  },
  30000,
);
