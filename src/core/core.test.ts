import { describe, it, expect } from "vitest";
import { parseProject, migrateProject, stableStringify } from "./project";
import { resolveTokens, exportTokensCSS } from "./tokens";
import { applyBatch } from "./operations";
export const example = () => ({
  schemaVersion: 2,
  projectId: "p",
  name: "Example",
  revision: 0,
  pages: [
    {
      screenId: "home",
      name: "Home",
      viewport: { width: 1200 },
      nodes: [{ id: "text", type: "Text", props: { text: "Hi" }, slots: {} }],
    },
  ],
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
});
describe("project", () => {
  it("round trips, migrates IDs and canonicalizes keys", () => {
    expect(parseProject(example())).toEqual(example());
    expect(
      migrateProject({
        schemaVersion: 1,
        screenId: "home",
        name: "Home",
        revision: 0,
        viewport: { width: 800 },
        nodes: example().pages[0].nodes,
      }).pages[0].nodes[0].id,
    ).toBe("text");
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("rejects unsupported versions, duplicates, code and unsafe assets", () => {
    for (const bad of [
      { ...example(), schemaVersion: 99 },
      { ...example(), pages: [...example().pages, ...example().pages] },
      {
        ...example(),
        pages: [
          {
            ...example().pages[0],
            nodes: [
              {
                id: "x",
                type: "Text",
                props: { onClick: "alert(1)" },
                slots: {},
              },
            ],
          },
        ],
      },
      {
        ...example(),
        pages: [
          {
            ...example().pages[0],
            nodes: [
              {
                id: "x",
                type: "Image",
                props: { src: "../secret" },
                slots: {},
              },
            ],
          },
        ],
      },
    ])
      expect(() => parseProject(bad)).toThrow();
  });
  it("preserves unknown nodes and rejects missing refs", () => {
    expect(
      parseProject({
        ...example(),
        pages: [
          {
            ...example().pages[0],
            nodes: [{ id: "x", type: "Future", props: { x: 3 }, slots: {} }],
          },
        ],
      }).pages[0].nodes[0].type,
    ).toBe("Future");
    expect(() =>
      parseProject({
        ...example(),
        pages: [
          {
            ...example().pages[0],
            nodes: [
              {
                id: "x",
                type: "Text",
                props: { text: { $token: "missing" } },
                slots: {},
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
describe("tokens", () => {
  it("resolves typed themed aliases and exports css", () => {
    const tokens = {
      base: { type: "color" as const, value: "#fff", themes: { dark: "#000" } },
      surface: { type: "color" as const, value: { $token: "base" } },
    };
    expect(resolveTokens(tokens, "dark").surface).toBe("#000");
    expect(exportTokensCSS(tokens, "dark")).toContain("--surface: #000");
  });
  it("rejects cycles and wrong types", () => {
    expect(() =>
      resolveTokens(
        {
          a: { type: "color", value: { $token: "b" } },
          b: { type: "color", value: { $token: "a" } },
        },
        "light",
      ),
    ).toThrow(/CYCLE/);
    expect(() =>
      resolveTokens({ a: { type: "number", value: "red" } }, "light"),
    ).toThrow();
  });
});
describe("operations", () => {
  it("applies batches atomically at one revision", () => {
    const p = parseProject(example());
    const next = applyBatch(p, {
      requestId: "r",
      baseRevision: 0,
      operations: [
        { type: "updateProps", nodeId: "text", props: { text: "Changed" } },
        {
          type: "addPage",
          page: {
            screenId: "other",
            name: "Other",
            viewport: { width: 800 },
            nodes: [],
          },
        },
      ],
    });
    expect(next.revision).toBe(1);
    expect(p.pages[0].nodes[0].props.text).toBe("Hi");
    expect(() =>
      applyBatch(p, { requestId: "r", baseRevision: 1, operations: [] }),
    ).toThrow(/REVISION/);
    expect(() =>
      applyBatch(p, {
        requestId: "r",
        baseRevision: 0,
        operations: [
          { type: "removeNode", nodeId: "text" },
          { type: "removeNode", nodeId: "missing" },
        ],
      }),
    ).toThrow();
    expect(p.pages[0].nodes).toHaveLength(1);
  });
  it("rejects moving a node inside itself", () => {
    const p = parseProject({
      ...example(),
      pages: [
        {
          ...example().pages[0],
          nodes: [
            {
              id: "stack",
              type: "Stack",
              props: { gap: 8 },
              slots: { content: example().pages[0].nodes },
            },
          ],
        },
      ],
    });
    expect(() =>
      applyBatch(p, {
        requestId: "r",
        baseRevision: 0,
        operations: [
          {
            type: "moveNode",
            nodeId: "stack",
            pageId: "home",
            parentId: "text",
            slot: "content",
            index: 0,
          },
        ],
      }),
    ).toThrow();
  });
});
it("validates legacy component props only for builtin and checks resolved gap bounds", () => {
  expect(
    parseProject({
      ...example(),
      library: { id: "product", version: "1" },
      pages: [
        {
          ...example().pages[0],
          nodes: [
            {
              id: "card",
              type: "Card",
              props: { title: "Hello", variant: "feature" },
              slots: {},
            },
          ],
        },
      ],
    }).pages[0].nodes[0].props.variant,
  ).toBe("feature");
  expect(() =>
    parseProject({
      ...example(),
      tokens: { large: { type: "number", value: 100 } },
      pages: [
        {
          ...example().pages[0],
          nodes: [
            {
              id: "stack",
              type: "Stack",
              props: { gap: { $token: "large" } },
              slots: { content: [] },
            },
          ],
        },
      ],
    }),
  ).toThrow(/INVALID_PROP/);
});
it("rejects malformed tokens, unsafe URLs, and excessive nesting", () => {
  expect(() =>
    parseProject({
      ...example(),
      tokens: { x: { type: "string", value: "ok", extra: "no" } },
    }),
  ).toThrow();
  expect(() =>
    parseProject({
      ...example(),
      pages: [
        {
          ...example().pages[0],
          nodes: [
            {
              id: "x",
              type: "Future",
              props: { href: "javascript:alert(1)" },
              slots: {},
            },
          ],
        },
      ],
    }),
  ).toThrow();
  let node: any = { id: "leaf", type: "Future", props: {}, slots: {} };
  for (let i = 0; i < 70; i++)
    node = {
      id: "n" + i,
      type: "Future",
      props: {},
      slots: { content: [node] },
    };
  expect(() =>
    parseProject({
      ...example(),
      pages: [{ ...example().pages[0], nodes: [node] }],
    }),
  ).toThrow(/DEPTH/);
});
it("rejects executable lowercase handlers and JSON that is too deeply nested", () => {
  expect(() =>
    parseProject({
      ...example(),
      library: { id: "future", version: "1" },
      pages: [
        {
          ...example().pages[0],
          nodes: [
            {
              id: "x",
              type: "Widget",
              props: { onclick: "alert(1)" },
              slots: {},
            },
          ],
        },
      ],
    }),
  ).toThrow(/EXECUTABLE/);
  let value: any = "x";
  for (let i = 0; i < 1000; i++) value = { a: value };
  expect(() =>
    parseProject({ ...example(), tokens: { x: { type: "string", value } } }),
  ).toThrow(/DEPTH/);
});
it("runs all tree and page operations while preserving atomicity", () => {
  let p = parseProject({
    ...example(),
    pages: [
      {
        ...example().pages[0],
        nodes: [
          {
            id: "stack",
            type: "Stack",
            props: { gap: 1 },
            slots: { content: example().pages[0].nodes },
          },
        ],
      },
    ],
  });
  p = applyBatch(p, {
    requestId: "all",
    baseRevision: 0,
    operations: [
      {
        type: "insertNode",
        pageId: "home",
        parentId: "stack",
        slot: "content",
        index: 1,
        node: { id: "second", type: "Text", props: { text: "Two" }, slots: {} },
      },
      { type: "moveNode", nodeId: "text", pageId: "home", index: 1 },
      { type: "setViewport", pageId: "home", width: 1000 },
      { type: "renamePage", pageId: "home", name: "Renamed" },
      { type: "setTokens", tokens: { g: { type: "number", value: 2 } } },
      { type: "setTheme", theme: "dark" },
    ],
  });
  expect(p.pages[0].nodes.map((n) => n.id)).toEqual(["stack", "text"]);
  expect(p.pages[0].viewport.width).toBe(1000);
  expect(p.pages[0].name).toBe("Renamed");
  expect(() =>
    applyBatch(p, {
      requestId: "bad",
      baseRevision: 1,
      operations: [{ type: "removePage", pageId: "home" }],
    }),
  ).toThrow(/PAGES/);
});
it("rejects non-JSON batches and unsupported operation fields", () => {
  const p = parseProject(example());
  expect(() =>
    applyBatch(p, {
      requestId: "x",
      baseRevision: 0,
      operations: [{ type: "removeNode", nodeId: "text", code: "evil" }] as any,
    }),
  ).toThrow(/FIELD/);
  expect(() =>
    applyBatch(p, {
      requestId: "x",
      baseRevision: 0,
      operations: [],
      author: (() => {}) as any,
    }),
  ).toThrow(/JSON/);
});
it("does not treat prototype token names as aliases and rejects CSS collisions", () => {
  expect(() =>
    resolveTokens(
      { x: { type: "string", value: { $token: "constructor" } } },
      "light",
    ),
  ).toThrow();
  expect(() =>
    exportTokensCSS(
      {
        "a.b": { type: "string", value: "x" },
        "a-b": { type: "string", value: "y" },
      },
      "light",
    ),
  ).toThrow(/COLLISION/);
});
it("rejects colors with invalid syntax and malformed themed overrides", () => {
  expect(() =>
    resolveTokens({ bad: { type: "color", value: "banana" } }, "light"),
  ).toThrow(/INVALID_TOKEN_VALUE/);
  expect(() =>
    resolveTokens({ bad: { type: "color", value: "#12345" } }, "light"),
  ).toThrow(/INVALID_TOKEN_VALUE/);
  expect(() =>
    resolveTokens(
      { bad: { type: "number", value: 1, themes: { dark: null } } },
      "dark",
    ),
  ).toThrow(/INVALID_TOKEN_VALUE/);
});
it("checks resolved asset references at their property key in every token mode", () => {
  const withAsset = (value: string, themes?: Record<string, string>) => ({
    ...example(),
    library: { id: "external", version: "1" },
    tokens: {
      resource: { type: "string", value, themes: themes ?? {} },
      alias: { type: "string", value: { $token: "resource" } },
    },
    pages: [
      {
        ...example().pages[0],
        nodes: [
          {
            id: "image",
            type: "Image",
            props: { slides: [{ src: { $token: "alias" } }] },
            slots: {},
          },
        ],
      },
    ],
  });
  for (const uri of [
    "javascript:alert(1)",
    "data:image/png;base64,x",
    "file:///etc/passwd",
    "/secret.png",
    "../secret.svg",
    "assets/../secret.svg",
  ]) {
    expect(() => parseProject(withAsset(uri))).toThrow(/UNSAFE/);
    expect(() =>
      parseProject(withAsset("assets/safe.svg", { dark: uri })),
    ).toThrow(/UNSAFE/);
    expect(() =>
      parseProject({
        ...withAsset(uri, { light: "assets/safe.svg" }),
        theme: "light",
      }),
    ).toThrow(/UNSAFE/);
  }
  const project = parseProject(
    withAsset("assets/safe.svg", { dark: "assets/dark.svg" }),
  );
  expect((project.pages[0].nodes[0].props.slides as any)[0].src).toEqual({
    $token: "alias",
  });
});
it("rejects dangerouslySetInnerHTML for unknown library props", () => {
  expect(() =>
    parseProject({
      ...example(),
      library: { id: "external", version: "1" },
      pages: [
        {
          ...example().pages[0],
          nodes: [
            {
              id: "raw",
              type: "Unknown",
              props: {
                dangerouslySetInnerHTML: { __html: "<script>x</script>" },
              },
              slots: {},
            },
          ],
        },
      ],
    }),
  ).toThrow(/EXECUTABLE/);
});

it("counts portable document limits in UTF-8 bytes", () => {
  const p = example();
  p.library = { id: "external", version: "1" };
  p.pages[0].nodes[0].props.text = "я".repeat(2_600_000);
  expect(() => parseProject(p)).toThrow("PROJECT_TOO_LARGE");
});
