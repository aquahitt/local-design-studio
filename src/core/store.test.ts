import { it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "./store";
import { parseProject } from "./project";
const roots: string[] = [];
const stores: ProjectStore[] = [];
const initial = () =>
  parseProject({
    schemaVersion: 2,
    projectId: "p",
    name: "Test",
    revision: 0,
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 800 },
        nodes: [
          { id: "text", type: "Text", props: { text: "Hello" }, slots: {} },
        ],
      },
    ],
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: {},
  });
async function root() {
  const r = await mkdtemp(join(tmpdir(), "studio-core-"));
  roots.push(r);
  return r;
}
async function open(r: string, create = true) {
  const s = await ProjectStore.open(
    r,
    create ? { initialProject: initial() } : {},
  );
  stores.push(s);
  return s;
}
const batch = {
  requestId: "change",
  baseRevision: 0,
  operations: [
    {
      type: "updateProps" as const,
      nodeId: "text",
      props: { text: "Changed" },
    },
  ],
};
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
it("persists restart, receipts and monotonic undo/redo", async () => {
  const r = await root();
  let s = await open(r);
  await s.apply(batch);
  await s.close();
  s = await open(r, false);
  expect((await s.apply(batch)).revision).toBe(1);
  await expect(s.apply({ ...batch, operations: [] })).rejects.toThrow(
    /REQUEST_ID/,
  );
  expect((await s.undo("undo", 1)).revision).toBe(2);
  expect(s.read().pages[0].nodes[0].props.text).toBe("Hello");
  expect((await s.redo("redo", 2)).revision).toBe(3);
  expect(s.read().pages[0].nodes[0].props.text).toBe("Changed");
});
it("serializes writers and rejects live locks or external edits", async () => {
  const r = await root();
  const s = await open(r);
  await expect(open(r, false)).rejects.toThrow(/LOCKED/);
  const result = await Promise.allSettled([
    s.apply(batch),
    s.apply({ ...batch, requestId: "second" }),
  ]);
  expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  await writeFile(join(r, "project.json"), JSON.stringify(initial()));
  await expect(s.undo("undo", 1)).rejects.toThrow(/EXTERNAL_CHANGE/);
});
it("opens copied projects, reclaims stale locks, and creates only explicitly", async () => {
  const r = await root();
  await expect(open(r, false)).rejects.toThrow(/NOT_FOUND/);
  const s = await open(r);
  await s.apply(batch);
  await s.close();
  const copy = await root();
  await cp(r, copy, { recursive: true });
  await writeFile(
    join(copy, ".studio", "lock.json"),
    JSON.stringify({ pid: 2147483647, nonce: "dead" }),
  );
  const copied = await open(copy, false);
  expect(copied.read().revision).toBe(1);
});
it("recovers a durable pending transaction", async () => {
  const r = await root();
  const s = await open(r);
  await s.apply(batch);
  await s.close();
  const state = JSON.parse(
    await readFile(join(r, ".studio", "state.json"), "utf8"),
  );
  await writeFile(join(r, ".studio", "pending.json"), JSON.stringify(state));
  await writeFile(join(r, "project.json"), JSON.stringify(initial()));
  const recovered = await open(r, false);
  expect(recovered.read().revision).toBe(1);
});
it("does not overwrite arbitrary documents and preserves memory on failed writes", async () => {
  const r = await root();
  await writeFile(join(r, "notes.txt"), "mine");
  await expect(open(r)).rejects.toThrow(/NOT_EMPTY/);
  const fresh = await root();
  const s = await open(fresh);
  await mkdir(join(fresh, ".studio", "pending.json"));
  await expect(s.apply(batch)).rejects.toThrow();
  expect(s.read().revision).toBe(0);
  expect(
    JSON.parse(await readFile(join(fresh, "project.json"), "utf8")).revision,
  ).toBe(0);
});
it("blocks writes after durable journal failure and recovers acknowledged state on reopen", async () => {
  const r = await root();
  const s = await open(r);
  await rm(join(r, ".studio", "state.json"));
  await mkdir(join(r, ".studio", "state.json"));
  await expect(s.apply(batch)).rejects.toThrow(/RECOVERY_REQUIRED/);
  expect(s.read().revision).toBe(0);
  await expect(s.apply({ ...batch, requestId: "new" })).rejects.toThrow(
    /RECOVERY_REQUIRED/,
  );
  await s.close();
  await rm(join(r, ".studio", "state.json"), { recursive: true });
  const recovered = await open(r, false);
  expect(recovered.read().revision).toBe(1);
  expect((await recovered.apply(batch)).revision).toBe(1);
});
it("rejects changed durable pending payload when external project edit is unrelated", async () => {
  const r = await root();
  const s = await open(r);
  await s.apply(batch);
  await s.close();
  const state = JSON.parse(
    await readFile(join(r, ".studio", "state.json"), "utf8"),
  );
  state.previousProject = initial();
  await writeFile(join(r, ".studio", "pending.json"), JSON.stringify(state));
  await writeFile(
    join(r, "project.json"),
    JSON.stringify({ ...initial(), name: "External" }),
  );
  await expect(open(r, false)).rejects.toThrow(/EXTERNAL_CHANGE/);
});
it("supports request IDs which shadow prototype members", async () => {
  const r = await root();
  const s = await open(r);
  expect((await s.apply({ ...batch, requestId: "constructor" })).revision).toBe(
    1,
  );
  expect((await s.undo("__proto__", 1)).revision).toBe(2);
  await s.close();
  const reopened = await open(r, false);
  expect((await reopened.undo("__proto__", 1)).revision).toBe(2);
});
it("recovers interrupted explicit creation without requiring initialProject again", async () => {
  const r = await root();
  await mkdir(join(r, ".studio"));
  await writeFile(
    join(r, ".studio", "pending.json"),
    JSON.stringify({
      version: 1,
      project: initial(),
      undo: [],
      redo: [],
      receipts: {},
    }),
  );
  const s = await open(r, false);
  expect(s.read().projectId).toBe("p");
  expect(
    JSON.parse(await readFile(join(r, "project.json"), "utf8")).projectId,
  ).toBe("p");
});
it("allows only one winner when several openers reclaim a stale lock", async () => {
  for (let iteration = 0; iteration < 5; iteration++) {
    const r = await root();
    const first = await open(r);
    await first.close();
    await writeFile(
      join(r, ".studio", "lock.json"),
      JSON.stringify({ pid: 2147483647, nonce: "stale" }),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => open(r, false)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
  }
});
it("rejects symlink roots, studio metadata, and canonical files without touching targets", async () => {
  const outside = await root();
  await writeFile(join(outside, "secret"), "private");
  const { symlink } = await import("node:fs/promises");
  for (const target of [
    "root",
    ".studio",
    "project.json",
    ".studio/state.json",
    ".studio/pending.json",
    ".studio/lock.json",
    ".studio/lock-reclaim.json",
  ]) {
    const r = await root();
    if (target === "root") {
      const link = join(r, "linked");
      await symlink(outside, link);
      await expect(open(link)).rejects.toThrow(/SYMLINK/);
      continue;
    }
    if (target === ".studio") {
      await symlink(outside, join(r, ".studio"));
      await expect(open(r)).rejects.toThrow(/SYMLINK/);
      continue;
    }
    if (target === "project.json") {
      await symlink(join(outside, "secret"), join(r, "project.json"));
      await expect(open(r, false)).rejects.toThrow(/SYMLINK/);
      continue;
    }
    const s = await open(r);
    await s.close();
    await rm(join(r, target), { force: true });
    await symlink(join(outside, "secret"), join(r, target));
    await expect(open(r, false)).rejects.toThrow(/SYMLINK/);
  }
  expect(await readFile(join(outside, "secret"), "utf8")).toBe("private");
});
it("keeps asset references portable when the entire project folder is copied", async () => {
  const r = await root();
  const project = parseProject({
    ...initial(),
    library: { id: "external", version: "1" },
    pages: [
      {
        ...initial().pages[0],
        nodes: [
          {
            id: "image",
            type: "Image",
            props: { src: "assets/logo.svg" },
            slots: {},
          },
        ],
      },
    ],
  });
  const s = await ProjectStore.open(r, { initialProject: project });
  stores.push(s);
  await writeFile(join(r, "assets", "logo.svg"), "<svg/>");
  await writeFile(join(r, "fixtures", "data.json"), "{}");
  await s.close();
  const copied = await root();
  await cp(r, copied, { recursive: true });
  const reopened = await open(copied, false);
  const src = reopened.read().pages[0].nodes[0].props.src as string;
  expect(src).toBe("assets/logo.svg");
  expect(await readFile(join(copied, src), "utf8")).toBe("<svg/>");
  expect(await readFile(join(copied, "fixtures", "data.json"), "utf8")).toBe(
    "{}",
  );
});
it("opens and durably migrates a legacy pilot screen while retaining stable IDs", async () => {
  const r = await root();
  const page = initial().pages[0];
  await writeFile(
    join(r, "project.json"),
    JSON.stringify({
      schemaVersion: 1,
      screenId: page.screenId,
      name: page.name,
      revision: 4,
      viewport: page.viewport,
      nodes: page.nodes,
    }),
  );
  const s = await open(r, false);
  expect(s.read().schemaVersion).toBe(2);
  expect(s.read().revision).toBe(4);
  expect(s.read().pages[0].nodes[0].id).toBe("text");
  expect(
    JSON.parse(await readFile(join(r, "project.json"), "utf8")).schemaVersion,
  ).toBe(2);
  await s.close();
  expect((await open(r, false)).read().pages[0].nodes[0].id).toBe("text");
});
