import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopProjects } from "../../desktop/project-manager";
import { createStudioServer } from "../service/server";
import { demoProject } from "../demo/project";
import { builtinLibrary } from "../library/builtin";
import { exampleLibrary } from "../library/example";
import { libraryMetadata } from "../library/sdk";

let base: string;
let projects: DesktopProjects;
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "desktop-projects-")));
  projects = new DesktopProjects(join(base, "settings"));
});
afterEach(async () => {
  await projects.close();
  await rm(base, { recursive: true, force: true });
});
async function project(root: string) {
  return JSON.parse(await readFile(join(root, "project.json"), "utf8"));
}
async function alive(session: { url: string; token: string }) {
  return (
    await fetch(session.url + "/api/project", {
      headers: { Authorization: `Bearer ${session.token}` },
    })
  ).status;
}

it("creates a named synthetic project, private recents and a trusted desktop origin", async () => {
  const root = join(base, "first");
  const session = await projects.open(root, {
    create: true,
    name: "Мой проект",
  });
  expect(session.root).toBe(root);
  expect(session.name).toBe("Мой проект");
  const saved = await project(root);
  expect(saved.projectId).not.toBe(demoProject().projectId);
  expect(saved.pages).toEqual(demoProject().pages);
  const capabilities = await (
    await fetch(session.url + "/api/capabilities", {
      headers: { Authorization: `Bearer ${session.token}` },
    })
  ).json();
  expect(capabilities.allowedOrigins).toEqual(["studio://app"]);
  expect(projects.current).toEqual(session);
  expect(await projects.recent()).toEqual([{ root, name: "Мой проект" }]);
  if (process.platform !== "win32") {
    expect((await stat(join(base, "settings"))).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(base, "settings", "recents.json"))).mode & 0o777,
    ).toBe(0o600);
  }
});

it("refuses missing, invalid and nonempty project roots without changing the current owner", async () => {
  const active = await projects.open(join(base, "active"), { create: true });
  const missing = join(base, "missing");
  await expect(projects.open(missing)).rejects.toThrow();
  await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  const invalid = join(base, "invalid");
  await mkdir(invalid);
  await writeFile(join(invalid, "project.json"), "{}");
  await expect(projects.open(invalid)).rejects.toThrow();
  await expect(projects.open(invalid, { create: true })).rejects.toThrow(
    "PROJECT_ROOT_NOT_EMPTY",
  );
  expect(await readFile(join(invalid, "project.json"), "utf8")).toBe("{}");
  expect(projects.current).toEqual(active);
  expect(await alive(active)).toBe(200);
});

it("serializes switching and persists unique projects and recents across restarts", async () => {
  const [first, second] = await Promise.all([
    projects.open(join(base, "one"), { create: true }),
    projects.open(join(base, "two"), { create: true, name: "Second" }),
  ]);
  expect((await project(first.root)).projectId).not.toBe(
    (await project(second.root)).projectId,
  );
  expect(projects.current).toEqual(second);
  expect(await projects.open(join(second.root, "."))).toEqual(second);
  expect(await projects.recent()).toEqual([
    { root: second.root, name: "Second" },
    { root: first.root, name: "one" },
  ]);
  await projects.close();
  expect(projects.current).toBeUndefined();
  projects = new DesktopProjects(join(base, "settings"));
  expect((await projects.recent()).map((entry) => entry.root)).toEqual([
    second.root,
    first.root,
  ]);
  expect((await projects.open(first.root)).name).toBe("one");
});

it("keeps the persistent example and recovers damaged recent settings", async () => {
  const first = await projects.example();
  const saved = await project(first.root);
  await projects.close();
  await writeFile(join(base, "settings", "recents.json"), "bad-json");
  expect(await projects.recent()).toEqual([]);
  const second = await projects.example();
  expect(await project(second.root)).toEqual(saved);
  expect(second.root).toBe(join(base, "settings", "example-project"));
  expect(await projects.recent()).toHaveLength(1);
});

it("rejects symlink roots and replaced active roots before returning credentials", async () => {
  const session = await projects.open(join(base, "real"), { create: true });
  const link = join(base, "link");
  await symlink(session.root, link, "dir");
  await expect(projects.open(link)).rejects.toThrow("UNSAFE_SYMLINK");
  await rename(session.root, join(base, "moved"));
  await symlink(join(base, "moved"), session.root, "dir");
  await expect(projects.open(session.root)).rejects.toThrow("UNSAFE_SYMLINK");
  await rm(session.root);
  await rename(join(base, "moved"), session.root);
});

it("diagnoses incompatible existing owners without shutting down either owner", async () => {
  const active = await projects.open(join(base, "active"), { create: true });
  const root = join(base, "foreign");
  const foreign = await createStudioServer({ root, port: 0 });
  try {
    await expect(projects.open(root)).rejects.toThrow(
      "OWNER_CONFIGURATION_MISMATCH",
    );
    expect(projects.current).toEqual(active);
    expect(await alive(active)).toBe(200);
    expect(await alive(foreign)).toBe(200);
  } finally {
    await foreign.close();
  }
});

it("attaches to compatible owners and closing the desktop preserves their service", async () => {
  const root = join(base, "owned");
  const foreign = await createStudioServer({
    root,
    port: 0,
    initialProject: demoProject(),
    autoApply: false,
    allowedOrigins: ["studio://app"],
    libraryMetadata: [
      libraryMetadata(builtinLibrary),
      libraryMetadata(exampleLibrary),
    ],
  });
  try {
    const attached = await projects.open(root);
    expect(attached.url).toBe(foreign.url);
    expect(attached.uiToken).toBe(foreign.uiToken);
    await projects.close();
    expect(await alive(foreign)).toBe(200);
    const preferences = await readFile(
      join(base, "settings", "recents.json"),
      "utf8",
    );
    expect(preferences).not.toContain(foreign.token);
    expect(preferences).not.toContain(foreign.uiToken);
  } finally {
    await foreign.close();
  }
});

it("does not overwrite settings symlinks and preserves the active owner on settings failure", async () => {
  const active = await projects.open(join(base, "active"), { create: true });
  const path = join(base, "settings", "recents.json");
  const target = join(base, "untouched.json");
  await writeFile(target, "keep me");
  await rm(path);
  await symlink(target, path);
  await expect(
    projects.open(join(base, "new"), { create: true }),
  ).rejects.toThrow("UNSAFE_SYMLINK");
  expect(await readFile(target, "utf8")).toBe("keep me");
  expect(projects.current).toEqual(active);
  expect(await alive(active)).toBe(200);
  // The failed candidate must release its lock so an ordinary later open succeeds.
  await rm(path);
  expect((await projects.open(join(base, "new"))).root).toBe(join(base, "new"));
});

it("rejects symlink project files without writing through them", async () => {
  const root = join(base, "linked-file");
  await mkdir(root);
  const target = join(base, "untouched-project.json");
  const bytes = JSON.stringify(demoProject());
  await writeFile(target, bytes);
  await symlink(target, join(root, "project.json"));
  await expect(projects.open(root)).rejects.toThrow("UNSAFE_SYMLINK");
  expect(await readFile(target, "utf8")).toBe(bytes);
});

it("detects a replaced active directory even when its canonical pathname is unchanged", async () => {
  const root = join(base, "active");
  const session = await projects.open(root, { create: true });
  const displaced = join(base, "displaced");
  await rename(root, displaced);
  await mkdir(root);
  await writeFile(join(root, "project.json"), JSON.stringify(demoProject()));
  try {
    await expect(projects.open(root)).rejects.toThrow("PROJECT_ROOT_CHANGED");
    expect(projects.current).toEqual(session);
    expect(await alive(session)).toBe(200);
  } finally {
    await rm(root, { recursive: true });
    await rename(displaced, root);
  }
});
