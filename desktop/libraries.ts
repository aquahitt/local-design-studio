import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { LibraryMetadata } from "../src/library/sdk";
import { compileLibrary } from "./library-compiler";

export interface DesktopLibraryBundle {
  id: string;
  root: string;
  files: string[];
  metadata: LibraryMetadata;
}
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
async function guard(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("UNSAFE_SYMLINK");
  } catch (error) {
    if (!missing(error)) throw error;
  }
}
/** Operator-only trusted roots; never reads paths from a project document. */
export class DesktopLibraries {
  constructor(private readonly userData: string) {}
  private async settings() {
    await guard(this.userData);
    await mkdir(this.userData, { recursive: true });
    const canonical = await realpath(this.userData);
    if (process.platform !== "win32") await chmod(canonical, 0o700);
    return canonical;
  }
  private async preferences(): Promise<Record<string, string>> {
    const path = join(await this.settings(), "libraries.json");
    await guard(path);
    try {
      const data: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) return {};
      return Object.fromEntries(
        Object.entries(data)
          .filter(([key, value]) => key.startsWith("/") || /^[A-Z]:/i.test(key))
          .filter(([, value]) => typeof value === "string"),
      ) as Record<string, string>;
    } catch (error) {
      if (missing(error) || error instanceof SyntaxError) return {};
      throw error;
    }
  }
  private async save(data: Record<string, string>) {
    const path = join(await this.settings(), "libraries.json");
    await guard(path);
    const temporary = path + "." + randomUUID() + ".tmp";
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(data, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await guard(path);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async configure(
    project: string,
    root: string,
    trusted: boolean,
  ): Promise<DesktopLibraryBundle> {
    if (!trusted) throw new Error("LIBRARY_TRUST_REQUIRED");
    await guard(root);
    if (!(await lstat(root)).isDirectory())
      throw new Error("LIBRARY_ROOT_NOT_DIRECTORY");
    const canonical = await realpath(root);
    const bundle = await this.compile(canonical);
    const preferences = await this.preferences();
    preferences[await realpath(project)] = canonical;
    await this.save(preferences);
    return bundle;
  }
  async load(project: string): Promise<DesktopLibraryBundle | undefined> {
    const root = (await this.preferences())[await realpath(project)];
    if (!root) return;
    await guard(root);
    return this.compile(await realpath(root));
  }
  async clear(project: string): Promise<void> {
    const preferences = await this.preferences();
    delete preferences[await realpath(project)];
    await this.save(preferences);
  }
  private async compile(root: string) {
    const settings = await this.settings();
    const cache = join(settings, "library-bundles");
    await guard(cache);
    await mkdir(cache, { recursive: true });
    const id = randomUUID();
    const output = join(cache, id);
    await mkdir(output);
    try {
      return await compileLibrary(root, output, id);
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
  }
}
