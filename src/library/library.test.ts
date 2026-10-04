import { describe, it, expect } from "vitest";
import {
  LibraryRegistry,
  libraryMetadata,
  toCoreTokens,
  validateLibraryProps,
} from "./sdk";
import { exampleLibrary } from "./example";
import {
  getConfiguredLibraryMetadata,
  studioLibraryPlugin,
} from "../../scripts/library/plugin";

describe("component library registry", () => {
  it("publishes serializable schemas and fixtures without executable renderers", () => {
    const data = libraryMetadata(exampleLibrary);
    expect(data.id).toBe("studio-example");
    expect(data.components.Button.fields.label.type).toBe("string");
    expect(JSON.stringify(data)).not.toContain("render");
    expect(data.components.Button.fixtures.length).toBeGreaterThan(1);
  });
  it("resolves exact versions and diagnoses unknown references without changing them", () => {
    const registry = new LibraryRegistry([exampleLibrary]);
    expect(
      registry.resolve({
        libraryId: exampleLibrary.id,
        libraryVersion: exampleLibrary.version,
        type: "Button",
      }).component,
    ).toBeDefined();
    const reference = {
      libraryId: "studio-example",
      libraryVersion: "99",
      type: "Future",
    };
    const result = registry.resolve(reference);
    expect(result.reference).toEqual(reference);
    expect(result.diagnostic?.code).toBe("library-version-unavailable");
    expect(
      registry.resolve({ ...reference, libraryVersion: exampleLibrary.version })
        .diagnostic?.code,
    ).toBe("component-unavailable");
  });
  it("clean clone metadata includes compatibility and example libraries unless operator opts in", () => {
    expect(getConfiguredLibraryMetadata({}).map((x) => x.id)).toEqual([
      "builtin",
      "studio-example",
    ]);
    expect(studioLibraryPlugin({}).name).toBe("studio-trusted-library");
  });
  it("rejects missing or relative external roots", () => {
    expect(() =>
      getConfiguredLibraryMetadata({ externalRoot: "../product" }),
    ).toThrow(/absolute/);
    expect(() =>
      getConfiguredLibraryMetadata({
        externalRoot: "/definitely-missing-design-library",
      }),
    ).toThrow();
  });
});

describe("operator enabled adapter", () => {
  it.skipIf(!process.env.STUDIO_LIBRARY_ROOT)(
    "discovers actual exports, real theme variants, and complex fixtures",
    () => {
      const library = getConfiguredLibraryMetadata({
        externalRoot: process.env.STUDIO_LIBRARY_ROOT,
      }).find((library) => library.id === "stroi-ui")!;
      expect(library.components.Button.fields.variant.options).toContain(
        "danger",
      );
      expect(
        library.components.BuildingPriceTables.defaultProps.tables,
      ).toBeDefined();
      expect(library.components.AttributeFields.support).toBe("rendered");
      expect(library.exports?.find((x) => x.name === "useTimers")?.kind).toBe(
        "hook",
      );
      expect(
        library.tokens.find((x) => x.name === "--accent")?.themes?.[
          "web-light"
        ],
      ).toBe("#f99828");
      expect(Object.keys(library.components).length).toBeGreaterThan(50);
    },
  );
});

it("validates known fields and preserves unknown forward-compatible properties", () => {
  expect(
    validateLibraryProps(exampleLibrary.components.Button, {
      label: 42,
      disabled: "yes",
    }),
  ).toHaveLength(2);
  expect(
    validateLibraryProps(exampleLibrary.components.Button, {
      future: { nested: true },
    }),
  ).toEqual([]);
});
it("converts CSS aliases and theme variants into editable core token values", () => {
  const metadata = libraryMetadata(exampleLibrary);
  metadata.tokens = [
    {
      name: "--accent",
      value: "#123456",
      category: "color",
      source: "base.css",
      themes: { dark: "#abcdef" },
    },
    {
      name: "--surface",
      value: "var(--accent)",
      category: "color",
      source: "base.css",
    },
  ];
  expect(toCoreTokens(metadata)).toEqual({
    accent: { type: "color", value: "#123456", themes: { dark: "#abcdef" } },
    surface: { type: "color", value: { $token: "accent" } },
  });
});
it.skipIf(!process.env.STUDIO_LIBRARY_ROOT)(
  "renders actual data-driven local components with synthetic fixtures",
  async () => {
    const { createServer } = await import("vite");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
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
      const library = libraries.find(
        (library: { id: string }) => library.id === "stroi-ui",
      );
      for (const name of [
        "Button",
        "Badge",
        "Checkbox",
        "AttributeFields",
        "BuildingPriceTables",
        "BuildingGallery",
        "ImageCarousel",
        "ServiceCard",
        "FxExplainer",
        "ObjectHistoryTimeline",
        "Markdown",
        "CategoryFilter",
        "RadioChips",
        "FeatureCheckboxes",
        "TagAutocomplete",
        "StarRating",
        "Money",
        "ApproxBynLine",
        "Avatar",
        "AnonymousAvatar",
        "SheetHeader",
        "SheetScrollHead",
        "MarkdownEditor",
        "OverflowActions",
        "Tabs",
      ]) {
        const component = library.components[name];
        const markup = renderToStaticMarkup(
          createElement(component.render, component.defaultProps),
        );
        expect(markup, `${name} renders a real fixture`).not.toContain(
          "requires",
        );
        expect(markup.length, name).toBeGreaterThan(30);
      }
    } finally {
      await server.close();
    }
  },
  30000,
);
it("example uses editable CSS tokens and provides distinct light and dark surfaces", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const tokens = toCoreTokens(libraryMetadata(exampleLibrary));
  expect(tokens.bg.themes?.dark).not.toBe(tokens.bg.value);
  expect(tokens["text-primary"].themes?.dark).not.toBe(
    tokens["text-primary"].value,
  );
  const button = exampleLibrary.components.Button;
  expect(
    renderToStaticMarkup(createElement(button.render, button.defaultProps)),
  ).toContain("var(--example-accent)");
  const card = exampleLibrary.components.Card;
  expect(
    renderToStaticMarkup(createElement(card.render, card.defaultProps)),
  ).toContain("var(--surface-raised)");
  expect(exampleLibrary.components.Text.defaultProps.text).toBe(
    "Design with real components",
  );
});
it.skipIf(!process.env.STUDIO_LIBRARY_ROOT)(
  "converts every authentic local theme to valid portable projects and CSS",
  async () => {
    const { resolveTokens, exportTokensCSS } = await import("../core/tokens");
    const { parseProject, stableStringify } = await import("../core/project");
    const library = getConfiguredLibraryMetadata({
      externalRoot: process.env.STUDIO_LIBRARY_ROOT,
    }).find((library) => library.id === "stroi-ui")!;
    for (const theme of library.themes) {
      const tokens = toCoreTokens(library);
      const project = parseProject({
        schemaVersion: 2,
        projectId: "adapter-regression",
        name: "Synthetic example",
        revision: 0,
        library: { id: library.id, version: library.version },
        theme: theme.id,
        tokens,
        pages: [
          {
            screenId: "overview",
            name: "Overview",
            viewport: { width: 390 },
            nodes: [],
          },
        ],
      });
      expect(() => resolveTokens(tokens, theme.id)).not.toThrow();
      expect(exportTokensCSS(tokens, theme.id)).toContain("--accent:");
      expect(parseProject(JSON.parse(stableStringify(project)))).toEqual(
        project,
      );
    }
  },
);

it("loads a runnable external manifest without the product checkout", async () => {
  const { resolve } = await import("node:path");
  const root = resolve("examples/library/external");
  const metadata = getConfiguredLibraryMetadata({ externalRoot: root }).find(
    (library) => library.id === "external-example",
  )!;
  expect(metadata.id).toBe("external-example");
  expect(metadata.sdkVersion).toBe(1);
  expect(metadata.capabilities?.tokenRefs).toBe(true);
  const { createServer } = await import("vite");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const server = await createServer({
    configFile: false,
    plugins: [studioLibraryPlugin({ externalRoot: root })],
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const { libraries } = await server.ssrLoadModule(
      "virtual:studio-libraries",
    );
    expect(
      renderToStaticMarkup(
        createElement(
          libraries.find(
            (library: { id: string }) => library.id === "external-example",
          ).components.Notice.render,
          {
            message: "External runtime",
          },
        ),
      ),
    ).toContain("External runtime");
  } finally {
    await server.close();
  }
});
it("rejects an incompatible SDK before importing operator library code", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "studio-sdk-test-"));
  try {
    writeFileSync(
      join(root, "studio.library.json"),
      JSON.stringify({ sdkVersion: 99, entry: "should-not-execute.tsx" }),
    );
    expect(() => getConfiguredLibraryMetadata({ externalRoot: root })).toThrow(
      /Unsupported library SDK/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("applies only explicit declarative migrations and preserves unknown components and fields", async () => {
  const { applyLibraryMigration } = await import("./sdk");
  const metadata = libraryMetadata(exampleLibrary);
  metadata.migrations = [
    {
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      renameTypes: { OldButton: "Button" },
      renameProps: { Button: { text: "label" } },
    },
  ];
  const original = {
    library: { id: metadata.id, version: "0.9.0" },
    pages: [
      {
        nodes: [
          {
            id: "known",
            type: "OldButton",
            props: { text: "Hello", future: true },
            slots: {
              children: [
                {
                  id: "future",
                  type: "Unknown",
                  props: { text: "Preserve" },
                  slots: {},
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const migrated = applyLibraryMigration(
    original,
    metadata,
    "1.0.0",
  ) as typeof original;
  expect(migrated.library.version).toBe("1.0.0");
  expect(migrated.pages[0].nodes[0].type).toBe("Button");
  expect(migrated.pages[0].nodes[0].props).toEqual({
    label: "Hello",
    future: true,
  });
  expect(migrated.pages[0].nodes[0].slots.children[0].type).toBe("Unknown");
  expect(original.library.version).toBe("0.9.0");
  expect(() => applyLibraryMigration(original, metadata, "9.0.0")).toThrow(
    /No declared migration/,
  );
});
it("confines generic manifest entry paths and symlinks to the operator root", async () => {
  const { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const manifest = JSON.parse(
    readFileSync("examples/library/external/studio.library.json", "utf8"),
  );
  const root = mkdtempSync(join(tmpdir(), "studio-entry-boundary-"));
  try {
    for (const entry of ["../outside.tsx", "/tmp/outside.tsx"]) {
      writeFileSync(
        join(root, "studio.library.json"),
        JSON.stringify({ ...manifest, entry }),
      );
      expect(() =>
        getConfiguredLibraryMetadata({ externalRoot: root }),
      ).toThrow(/relative.*within/);
    }
    symlinkSync(
      resolve("examples/library/external/src/library.tsx"),
      join(root, "linked.tsx"),
    );
    writeFileSync(
      join(root, "studio.library.json"),
      JSON.stringify({ ...manifest, entry: "linked.tsx" }),
    );
    expect(() => getConfiguredLibraryMetadata({ externalRoot: root })).toThrow(
      /escaped/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("does not erase a current property when a declared migration rename conflicts", async () => {
  const { applyLibraryMigration } = await import("./sdk");
  const metadata = libraryMetadata(exampleLibrary);
  metadata.migrations = [
    {
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      renameProps: { Button: { text: "label" } },
    },
  ];
  expect(() =>
    applyLibraryMigration(
      {
        library: { id: metadata.id, version: "0.9.0" },
        pages: [
          {
            nodes: [
              {
                type: "Button",
                props: { text: "old", label: "keep" },
                slots: {},
              },
            ],
          },
        ],
      },
      metadata,
      "1.0.0",
    ),
  ).toThrow(/conflict/);
});
it("validates the builtin pilot compatibility metadata and resolves each legacy renderer", async () => {
  const { builtinLibrary } = await import("./builtin");
  const { validateLibraryMetadata } = await import("./sdk");
  expect(() => validateLibraryMetadata(builtinLibrary)).not.toThrow();
  const registry = new LibraryRegistry([builtinLibrary]);
  for (const type of ["Stack", "Card", "Text", "Button", "Metric"])
    expect(
      registry.resolve({ libraryId: "builtin", libraryVersion: "1", type })
        .component?.render,
    ).toBeTypeOf("function");
  expect(builtinLibrary.components.Stack.slots).toEqual(["content"]);
  expect(builtinLibrary.components.Card.slots).toEqual(["content"]);
});
