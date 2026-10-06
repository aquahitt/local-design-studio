import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "./store";
const roots: string[] = [];
const stores: ProjectStore[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "studio-migrate-"));
  roots.push(value);
  return value;
}
const legacy = () => ({
  schemaVersion: 1,
  screenId: "old-screen",
  name: "Старый проект",
  revision: 4,
  viewport: { width: 800 },
  nodes: [
    {
      id: "stable-text",
      type: "Text",
      props: { text: "Сохранить" },
      slots: {},
    },
  ],
});
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("backs up exact legacy bytes before schema1 materialization and preserves IDs/data", async () => {
  const directory = await root();
  const original = Buffer.from(JSON.stringify(legacy(), null, 3) + "\n");
  await writeFile(join(directory, "project.json"), original);
  const store = await ProjectStore.open(directory);
  stores.push(store);
  const digest = createHash("sha256").update(original).digest("hex");
  const backup = join(
    directory,
    ".studio",
    "backups",
    `project-v1-${digest}.json`,
  );
  expect(await readFile(backup)).toEqual(original);
  expect(store.read().pages[0].nodes).toEqual(legacy().nodes);
  expect(store.read().pages[0].screenId).toBe("old-screen");
  expect(store.read().revision).toBe(4);
  expect(
    JSON.parse(await readFile(join(directory, "project.json"), "utf8"))
      .schemaVersion,
  ).toBe(2);
  await store.close();
  const reopened = await ProjectStore.open(directory);
  stores.push(reopened);
  expect(await readdir(join(directory, ".studio", "backups"))).toEqual([
    `project-v1-${digest}.json`,
  ]);
});

it("rejects an unsafe legacy project without rewriting it or creating a backup", async () => {
  const directory = await root();
  const input = legacy() as any;
  input.nodes[0].props.onClick = "alert(1)";
  const original = JSON.stringify(input);
  await writeFile(join(directory, "project.json"), original);
  await expect(ProjectStore.open(directory)).rejects.toThrow(
    "EXECUTABLE_FIELD",
  );
  expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
    original,
  );
  await expect(
    readdir(join(directory, ".studio", "backups")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("fails safely when backup path is a symlink", async () => {
  const directory = await root(),
    outside = await root();
  const original = JSON.stringify(legacy());
  await writeFile(join(directory, "project.json"), original);
  await mkdir(join(directory, ".studio"));
  await symlink(
    outside,
    join(directory, ".studio", "backups"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(ProjectStore.open(directory)).rejects.toThrow(
    "SYMLINK_FORBIDDEN",
  );
  expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
    original,
  );
  expect(await readdir(outside)).toEqual([]);
});

it("never overwrites a conflicting preexisting backup", async () => {
  const directory = await root();
  const original = Buffer.from(JSON.stringify(legacy()));
  const digest = createHash("sha256").update(original).digest("hex");
  await writeFile(join(directory, "project.json"), original);
  await mkdir(join(directory, ".studio", "backups"), { recursive: true });
  const backup = join(
    directory,
    ".studio",
    "backups",
    `project-v1-${digest}.json`,
  );
  await writeFile(backup, "different data");
  await expect(ProjectStore.open(directory)).rejects.toThrow(
    "MIGRATION_BACKUP_CONFLICT",
  );
  expect(await readFile(join(directory, "project.json"))).toEqual(original);
  expect(await readFile(backup, "utf8")).toBe("different data");
});

it("preserves the legacy file when the backup directory cannot be created", async () => {
  const directory = await root();
  const original = Buffer.from(JSON.stringify(legacy()));
  await writeFile(join(directory, "project.json"), original);
  await mkdir(join(directory, ".studio"));
  await writeFile(join(directory, ".studio", "backups"), "not a directory");
  await expect(ProjectStore.open(directory)).rejects.toMatchObject({
    code: "ENOTDIR",
  });
  expect(await readFile(join(directory, "project.json"))).toEqual(original);
});
