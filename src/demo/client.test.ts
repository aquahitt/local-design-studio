import { it, expect } from "vitest";
import { BrowserDemoClient } from "./client";
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
it("persists edits and monotonic shared undo/redo across reload", async () => {
  const s = storage();
  let c = new BrowserDemoClient(s);
  const p = await c.read();
  await c.apply(
    p.revision,
    [{ type: "updateProps", nodeId: "demo-title", props: { text: "Edited" } }],
    "Edit",
  );
  c = new BrowserDemoClient(s);
  expect((await c.read()).pages[0].nodes[0].props.text).toBe("Edited");
  const undone = await c.history("undo", 1);
  expect(undone.revision).toBe(2);
  expect(undone.pages[0].nodes[0].props.text).not.toBe("Edited");
  expect((await c.history("redo", 2)).revision).toBe(3);
});
it("rejects stale and invalid batches without partial persistence", async () => {
  const s = storage();
  const c = new BrowserDemoClient(s);
  await c.apply(0, [{ type: "setTheme", theme: "dark" }], "Theme");
  await expect(
    c.apply(0, [{ type: "removeNode", nodeId: "demo-title" }], "Stale"),
  ).rejects.toThrow("REVISION_CONFLICT");
  await expect(
    c.apply(
      1,
      [
        { type: "setTheme", theme: "light" },
        { type: "updateProps", nodeId: "demo-title", props: { size: 999 } },
      ],
      "Invalid",
    ),
  ).rejects.toThrow("INVALID_COMPONENT_PROP");
  expect((await new BrowserDemoClient(s).read()).theme).toBe("dark");
});
it("simulated proposals require approval and apply as one undo step", async () => {
  const c = new BrowserDemoClient(storage());
  const proposal = await c.request<any>("demo/proposal", {});
  await expect(
    c.request("proposals/" + proposal.id + "/apply", {}),
  ).rejects.toThrow("APPROVAL_REQUIRED");
  await c.approve(proposal.id);
  expect((await c.read()).revision).toBe(1);
  expect((await c.proposals()).find((p) => p.id === proposal.id)?.status).toBe(
    "applied",
  );
  expect(
    (await c.history("undo", 1)).pages[0].nodes[0].props.text,
  ).not.toContain("агента");
});
it("failed browser storage retains the last acknowledged revision", async () => {
  const s = storage();
  const c = new BrowserDemoClient(s);
  s.setItem = () => {
    throw new Error("Quota exceeded");
  };
  await expect(
    c.apply(0, [{ type: "setTheme", theme: "dark" }], "Theme"),
  ).rejects.toThrow("Quota");
  expect((await c.read()).revision).toBe(0);
});
it("reset restores public fixtures without changing unrelated browser storage", async () => {
  const s = storage();
  s.setItem("other-app", "private");
  const c = new BrowserDemoClient(s);
  await c.apply(0, [{ type: "setTheme", theme: "dark" }], "Theme");
  await BrowserDemoClient.reset(s);
  expect((await new BrowserDemoClient(s).read()).revision).toBe(0);
  expect(s.getItem("other-app")).toBe("private");
});

it("acknowledges proposal status and project in the same browser snapshot", async () => {
  const s = storage();
  const c = new BrowserDemoClient(s);
  const p = await c.request<any>("demo/proposal", {});
  await c.request("proposals/" + p.id + "/approve", {});
  const write = s.setItem;
  let writes = 0;
  s.setItem = (key, value) => {
    if (++writes === 2) throw new Error("Quota between snapshots");
    write(key, value);
  };
  await expect(
    c.request<any>("proposals/" + p.id + "/apply", {}),
  ).resolves.toMatchObject({ revision: 1 });
  const reopened = new BrowserDemoClient(s);
  expect((await reopened.proposals())[0].status).toBe("applied");
  expect((await reopened.read()).revision).toBe(1);
});

it("refreshes shared browser storage and rejects a stale tab mutation", async () => {
  const s = storage();
  const a = new BrowserDemoClient(s);
  const b = new BrowserDemoClient(s);
  await a.apply(
    0,
    [
      {
        type: "updateProps",
        nodeId: "demo-title",
        props: { text: "Tab A edit" },
      },
    ],
    "A",
  );
  await expect(
    b.apply(0, [{ type: "setTheme", theme: "dark" }], "B"),
  ).rejects.toThrow("REVISION_CONFLICT");
  expect((await b.read()).pages[0].nodes[0].props.text).toBe("Tab A edit");
  await BrowserDemoClient.reset(s);
  expect((await a.read()).revision).toBe(0);
});
it("demo rejection persists and prevents acceptance", async () => {
  const s = storage();
  let c = new BrowserDemoClient(s);
  const p = await c.request<any>("demo/proposal", {});
  await c.reject(p.id);
  c = new BrowserDemoClient(s);
  expect((await c.proposals())[0].status).toBe("rejected");
  await expect(c.approve(p.id)).rejects.toThrow("PROPOSAL_REJECTED");
  expect((await c.read()).revision).toBe(0);
});
