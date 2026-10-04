import { it, expect } from "vitest";
import { readProjectPage } from "./read";
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
