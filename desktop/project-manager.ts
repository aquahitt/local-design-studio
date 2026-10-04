import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  parseProject,
  PROJECT_LIMITS,
  type Project,
} from "../src/core/project";
import { demoProject } from "../src/demo/project";
import { builtinLibrary } from "../src/library/builtin";
import { exampleLibrary } from "../src/library/example";
import { libraryMetadata } from "../src/library/sdk";
import { connectStudioOwner } from "../src/service/attach";

export type DesktopProjectSession = {
  root: string;
  name: string;
  url: string;
  token: string;
  uiToken: string;
};
export type RecentProject = Pick<DesktopProjectSession, "root" | "name">;
type Owner = Awaited<ReturnType<typeof connectStudioOwner>>;
type Identity = { dev: number; ino: number };

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
async function guard(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("UNSAFE_SYMLINK");
  } catch (error) {
    if (!missing(error)) throw error;
  }
}
async function directory(path: string, create: boolean): Promise<string> {
  const absolute = resolve(path);
  await guard(absolute);
  if (create) await mkdir(absolute, { recursive: true });
  await guard(absolute);
  if (!(await lstat(absolute)).isDirectory())
    throw new Error("PROJECT_ROOT_NOT_DIRECTORY");
  return realpath(absolute);
}
async function readProject(root: string): Promise<Project> {
  const path = join(root, "project.json");
  await guard(path);
  const info = await lstat(path);
  if (!info.isFile()) throw new Error("INVALID_PROJECT_FILE");
  if (info.size > PROJECT_LIMITS.bytes) throw new Error("PROJECT_TOO_LARGE");
  return parseProject(JSON.parse(await readFile(path, "utf8")));
}

/** Project ownership and preferences live entirely in the Node utility process. */
export class DesktopProjects {
  private queue: Promise<unknown> = Promise.resolve();
  private active?: {
    session: DesktopProjectSession;
    owner: Owner;
    identity: Identity;
  };
  private settingsRoot?: string;

  constructor(private readonly userData: string) {}

  get current(): DesktopProjectSession | undefined {
    return this.active ? { ...this.active.session } : undefined;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async settings(): Promise<string> {
    const root = await directory(this.userData, true);
    if (this.settingsRoot && root !== this.settingsRoot)
      throw new Error("SETTINGS_ROOT_CHANGED");
    this.settingsRoot = root;
    if (process.platform !== "win32") await chmod(root, 0o700);
    return root;
  }

  private async readRecents(): Promise<RecentProject[]> {
    const path = join(await this.settings(), "recents.json");
    await guard(path);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (missing(error) || error instanceof SyntaxError) return [];
      throw error;
    }
    // Preferences are expendable; damaged preferences never modify project data.
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is RecentProject =>
          item !== null &&
          typeof item === "object" &&
          typeof item.root === "string" &&
          item.root.length > 0 &&
          typeof item.name === "string" &&
          item.name.length > 0,
      )
      .map(({ root, name }) => ({ root, name }))
      .slice(0, 20);
  }

  private async remember(session: DesktopProjectSession): Promise<void> {
    const recents = [
      { root: session.root, name: session.name },
      ...(await this.readRecents()).filter(
        (item) => item.root !== session.root,
      ),
    ].slice(0, 20);
    const path = join(await this.settings(), "recents.json");
    await guard(path);
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(recents, null, 2) + "\n");
        await file.sync();
      } finally {
        await file.close();
      }
      await guard(path);
      await rename(temp, path);
      // Windows does not support opening directories for fsync.
      if (process.platform !== "win32") {
        const dir = await open(dirname(path), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    } finally {
      await unlink(temp).catch((error: unknown) => {
        if (!missing(error)) throw error;
      });
    }
  }

  open(
    root: string,
    options: { create?: boolean; name?: string } = {},
  ): Promise<DesktopProjectSession> {
    return this.serialize(() => this.openProject(root, options));
  }

  private async openProject(
    root: string,
    options: { create?: boolean; name?: string },
  ): Promise<DesktopProjectSession> {
    const canonical = await directory(root, Boolean(options.create));
    const identity = await lstat(canonical);
    if (this.active?.session.root === canonical) {
      if (
        identity.dev !== this.active.identity.dev ||
        identity.ino !== this.active.identity.ino
      )
        throw new Error("PROJECT_ROOT_CHANGED");
      return { ...this.active.session };
    }
    let initialProject: Project | undefined;
    let project: Project;
    if (options.create) {
      if ((await readdir(canonical)).length)
        throw new Error("PROJECT_ROOT_NOT_EMPTY");
      initialProject = parseProject({
        ...demoProject(),
        projectId: randomUUID(),
        name: options.name?.trim() || basename(canonical),
      });
      project = initialProject;
    } else {
      project = await readProject(canonical);
    }
    const owner = await connectStudioOwner({
      root: canonical,
      initialProject,
      port: 0,
      allowedOrigins: ["studio://app"],
      autoApply: false,
      libraryMetadata: [
        libraryMetadata(builtinLibrary),
        libraryMetadata(exampleLibrary),
      ],
    });
    const session: DesktopProjectSession = {
      root: canonical,
      name: project.name,
      url: owner.url,
      token: owner.token,
      uiToken: owner.uiToken,
    };
    try {
      await this.remember(session);
      await this.active?.owner.close();
    } catch (error) {
      await owner.close();
      throw error;
    }
    this.active = { session, owner, identity };
    return { ...session };
  }

  example(): Promise<DesktopProjectSession> {
    return this.serialize(async () => {
      const root = join(await this.settings(), "example-project");
      await guard(root);
      let create = false;
      try {
        await lstat(root);
      } catch (error) {
        if (!missing(error)) throw error;
        create = true;
      }
      return this.openProject(root, { create, name: "Studio Playground" });
    });
  }

  recent(): Promise<RecentProject[]> {
    return this.serialize(() => this.readRecents());
  }

  close(): Promise<void> {
    return this.serialize(async () => {
      await this.active?.owner.close();
      this.active = undefined;
    });
  }
}
