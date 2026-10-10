import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface OwnerConnection {
  url: string;
  token: string;
  pid: number;
}
export class OwnerRequestError extends Error {
  constructor(public readonly details: Record<string, unknown>) {
    super(
      typeof details.error === "string" ? details.error : "OWNER_UNAVAILABLE",
    );
  }
}

/** Credentials are operator-local; never follow symlinks or contact a remote host. */
export async function readOwnerConnection(
  root: string,
): Promise<OwnerConnection> {
  try {
    for (const path of [
      root,
      join(root, ".studio"),
      join(root, ".studio/connection.json"),
    ]) {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error("UNSAFE_SYMLINK");
    }
    const connection = JSON.parse(
      await readFile(join(root, ".studio/connection.json"), "utf8"),
    );
    if (
      !connection ||
      !Number.isInteger(connection.pid) ||
      connection.pid <= 0 ||
      typeof connection.token !== "string" ||
      !connection.token.trim() ||
      typeof connection.url !== "string"
    )
      throw new Error("INVALID_CONNECTION");
    const url = new URL(connection.url);
    if (
      url.hostname !== "127.0.0.1" ||
      url.protocol !== "http:" ||
      !url.port ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("INVALID_CONNECTION");
    process.kill(connection.pid, 0);
    return { url: url.origin, token: connection.token, pid: connection.pid };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH")
      throw new Error("OWNER_NOT_RUNNING");
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw new Error("INVALID_CONNECTION");
    throw error;
  }
}

/** Serialize once: retry an ambiguous delivery with exactly the same mutation ID and body. */
export function createOwnerRequest(root: string, initial: OwnerConnection) {
  let connection = initial;
  return async (path: string, body?: unknown) => {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(connection.url + "/api/" + path, {
          method: serialized === undefined ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
          },
          body: serialized,
          signal: AbortSignal.timeout(
            ["render", "inspect"].includes(path) ? 30000 : 3000,
          ),
          redirect: "error",
        });
      } catch {
        if (attempt === 1) throw new Error("OWNER_NOT_RUNNING");
        connection = await readOwnerConnection(root);
        continue;
      }
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        connection = await readOwnerConnection(root);
        continue;
      }
      let result: any;
      try {
        result = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) throw error;
        if (attempt === 1) throw new Error("OWNER_NOT_RUNNING");
        connection = await readOwnerConnection(root);
        continue;
      }
      if (!response.ok)
        throw new OwnerRequestError(result as Record<string, unknown>);
      return result;
    }
    throw new Error("OWNER_NOT_RUNNING");
  };
}
