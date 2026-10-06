import { it, expect } from "vitest";
import {
  readProjectPage,
  readComponents,
  readComponent,
  readPages,
} from "./read";
it("paginates a stable preorder past500 nodes and exposes parent/slot relationships and node filters", () => {
  const project: any = {
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 1200 },
        nodes: [
          {
            id: "stack",
            type: "Stack",
            props: {},
            slots: {
              content: Array.from({ length: 501 }, (_, i) => ({
                id: "n" + i,
                type: "Text",
                props: { text: "" + i },
                slots: {},
              })),
            },
          },
        ],
      },
    ],
  };
  const first = readProjectPage(project, { limit: 500 });
  expect(first.pages[0].nodes[0].id).toBe("stack");
  expect(first.pagination).toEqual({
    total: 502,
    offset: 0,
    limit: 500,
    nextOffset: 500,
    truncated: true,
  });
  expect(first.nodes[1].parentId).toBe("stack");
  expect(first.nodes[1].slot).toBe("content");
  const last = readProjectPage(project, { offset: 500, limit: 500 });
  expect(last.nodes.map((n) => n.id)).toEqual(["n499", "n500"]);
  expect(last.pagination.nextOffset).toBe(null);
  expect(readProjectPage(project, { nodeId: "n500" }).nodes[0].id).toBe("n500");
});

it("component summaries bound large catalogs and filter before paging", () => {
  const library: any = {
    id: "big",
    name: "Big",
    version: "1",
    themes: [],
    tokens: [],
    components: Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        "Card" + index,
        {
          name: "Card " + index,
          category: index % 2 ? "odd" : "even",
          fields: { title: { type: "string" } },
          defaultProps: { title: "large fixture".repeat(1000) },
          fixtures: [
            { name: "sample", props: { content: "large".repeat(1000) } },
          ],
        },
      ]),
    ),
  };
  const first = readComponents([library], {
    libraryId: "big",
    category: "even",
    query: "card",
    limit: 2,
  });
  expect(first.components.map((c) => c.id)).toEqual(["Card0", "Card2"]);
  expect(first.pagination).toMatchObject({ total: 251, nextOffset: 2 });
  expect(
    readComponents([library], { category: "even", offset: 2, limit: 2 })
      .components[0].id,
  ).toBe("Card4");
  expect(JSON.stringify(first).length).toBeLessThan(1000);
  expect(readComponent([library], "big", "Card0").defaultProps.title).toBe(
    library.components.Card0.defaultProps.title,
  );
  expect(() => readComponent([library], "big", "toString")).toThrow(
    "COMPONENT_NOT_FOUND",
  );
});

it("narrow document reads retain revisions and groups while omitting large token payloads", () => {
  const project: any = {
    schemaVersion: 2,
    revision: 12,
    groups: [{ id: "g", name: "Group", pages: ["home"] }],
    tokens: { huge: "value".repeat(20000) },
    pages: [
      { screenId: "home", name: "Home", viewport: { width: 1200 }, nodes: [] },
    ],
  };
  for (const result of [
    readPages(project),
    readProjectPage(project, { pageId: "home" }, false),
  ]) {
    expect(result.revision).toBe(12);
    expect(result.groups).toEqual(project.groups);
    expect(result).not.toHaveProperty("tokens");
    expect(JSON.stringify(result).length).toBeLessThan(1000);
  }
  expect(readProjectPage(project)).toHaveProperty("tokens", project.tokens);
});

it("compact page reads omit unbounded definitions and discussions while compatible project reads retain them", () => {
  const project: any = {
    schemaVersion: 2,
    revision: 2,
    groups: [],
    tokens: {},
    annotations: [{ id: "a", text: "large".repeat(10000) }],
    designComponents: [
      {
        id: "definition",
        nodes: [{ props: { content: "large".repeat(10000) } }],
      },
    ],
    pages: [
      { screenId: "home", name: "Home", viewport: { width: 390 }, nodes: [] },
    ],
  };
  for (const result of [
    readPages(project),
    readProjectPage(project, { pageId: "home" }, false),
  ]) {
    expect(result).not.toHaveProperty("designComponents");
    expect(result).not.toHaveProperty("annotations");
    expect(JSON.stringify(result).length).toBeLessThan(1000);
  }
  expect(readProjectPage(project)).toHaveProperty(
    "designComponents",
    project.designComponents,
  );
  expect(readProjectPage(project)).toHaveProperty(
    "annotations",
    project.annotations,
  );
});
