import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createStudioServer, type StudioOptions } from "./server";
import { stableStringify } from "../core/project";
async function guard(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("UNSAFE_SYMLINK");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
/** Attach a trusted UI process to the fixed project owner or acquire sole ownership. */
export async function connectStudioOwner(options: StudioOptions) {
  const root = resolve(options.root),
    dir = join(root, ".studio");
  await guard(root);
  await guard(dir);
  const path = join(dir, "connection.json");
  await guard(path);
  await guard(join(dir, "ui-connection.json"));
  let credential: { url: string; token: string; pid: number };
  try {
    credential = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return createStudioServer({ ...options, root });
    throw e;
  }
  if (!Number.isInteger(credential.pid) || credential.pid <= 0)
    throw new Error("INVALID_OWNER_CONNECTION");
  try {
    process.kill(credential.pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH")
      return createStudioServer({ ...options, root });
    throw e;
  }
  const url = new URL(credential.url);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("INVALID_OWNER_CONNECTION");
  const ui = JSON.parse(
    await readFile(join(dir, "ui-connection.json"), "utf8"),
  ) as { url: string; uiToken: string; pid: number };
  if (
    ui.url !== credential.url ||
    ui.pid !== credential.pid ||
    typeof ui.uiToken !== "string" ||
    !ui.uiToken
  )
    throw new Error("INVALID_UI_CONNECTION");
  const headers = { Authorization: `Bearer ${credential.token}` };
  async function probe(route: string) {
    const response = await fetch(credential.url + "/api/" + route, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("OWNER_UNAVAILABLE");
    return response.json();
  }
  await probe("project");
  const metadata = await probe("components");
  if (
    options.libraryMetadata !== undefined &&
    stableStringify(metadata) !== stableStringify(options.libraryMetadata)
  )
    throw new Error("OWNER_CONFIGURATION_MISMATCH");
  const capabilities = await probe("capabilities");
  if (
    options.allowedOrigins?.some(
      (origin) => !capabilities.allowedOrigins?.includes(origin),
    )
  )
    throw new Error("OWNER_ORIGIN_MISMATCH");
  if (
    options.autoApply !== undefined &&
    Boolean(options.autoApply) !== Boolean(capabilities.autoApply)
  )
    throw new Error("OWNER_CONFIGURATION_MISMATCH");
  return {
    url: credential.url,
    token: credential.token,
    uiToken: ui.uiToken,
    async close() {
      /* The attached UI does not own the project process or its lock. */
    },
  };
}
