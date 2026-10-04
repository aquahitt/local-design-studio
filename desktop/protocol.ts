import { readFile } from "node:fs/promises";
import { resolve, extname, relative, isAbsolute } from "node:path";
export const STUDIO_ORIGIN = "studio://app";
export interface DesktopSession {
  url: string;
  token: string;
  uiToken: string;
}
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const json = (status: number, error: string) =>
  Response.json({ error }, { status });
export function createDesktopHandler(
  root: string,
  active: () => DesktopSession | undefined,
  request: typeof fetch = fetch,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      if (
        url.protocol !== "studio:" ||
        !["app", "preview"].includes(url.hostname) ||
        url.port ||
        url.username ||
        url.password
      )
        return json(403, "INVALID_ORIGIN");
      const path = decodeURIComponent(url.pathname);
      if (url.hostname === "preview" && path.startsWith("/api/"))
        return json(403, "PREVIEW_API_FORBIDDEN");
      if (path.includes("..") || path.includes("\\") || path.includes("\0"))
        return json(403, "INVALID_PATH");
      if (
        path.startsWith("/api/") ||
        /^\/assets\/[a-f0-9]{64}\.svg$/.test(path)
      ) {
        const session = active();
        if (!session) return json(503, "NO_PROJECT_OPEN");
        if (path === "/api/session")
          return req.method === "GET"
            ? Response.json(
                { token: session.token, uiToken: session.uiToken },
                { headers: { "Cache-Control": "no-store" } },
              )
            : json(405, "METHOD_NOT_ALLOWED");
        const asset = /^\/assets\/[a-f0-9]{64}\.svg$/.test(path);
        if (
          !asset &&
          !/^\/api\/(project|components|tokens|context|proposals(?:\/[^/]+(?:\/(approve|apply))?)?|operations|undo|redo|assets|schema|capabilities)$/.test(
            path,
          )
        )
          return json(404, "NOT_FOUND");
        if (
          !["GET", "POST"].includes(req.method) ||
          (asset && req.method !== "GET")
        )
          return json(405, "METHOD_NOT_ALLOWED");
        const headers: Record<string, string> = {
          Origin: STUDIO_ORIGIN,
          Authorization: asset
            ? `Bearer ${session.token}`
            : (req.headers.get("authorization") ?? ""),
        };
        const ui = req.headers.get("x-studio-ui-token");
        if (ui) headers["x-studio-ui-token"] = ui;
        if (req.method === "POST") headers["Content-Type"] = "application/json";
        const body =
          req.method === "POST" ? await req.arrayBuffer() : undefined;
        if (body && body.byteLength > 1024 * 1024)
          return json(413, "PAYLOAD_TOO_LARGE");
        const response = await request(
          session.url + (asset ? "/api" + path : path),
          {
            method: req.method,
            headers,
            body,
            signal: AbortSignal.timeout(15000),
          },
        );
        const output = new Headers({
          "Content-Type":
            response.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        const csp = response.headers.get("content-security-policy");
        if (csp) output.set("Content-Security-Policy", csp);
        return new Response(await response.arrayBuffer(), {
          status: response.status,
          headers: output,
        });
      }
      if (req.method !== "GET") return json(405, "METHOD_NOT_ALLOWED");
      const file = resolve(
        root,
        ["/", "/preview", "/pilot"].includes(path) ? "index.html" : "." + path,
      );
      const rel = relative(resolve(root), file);
      if (rel.startsWith("..") || isAbsolute(rel))
        return json(403, "INVALID_PATH");
      try {
        return new Response(await readFile(file), {
          headers: {
            "Content-Type": mime[extname(file)] ?? "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy":
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' studio://preview; object-src 'none'; base-uri 'none'",
          },
        });
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code === "ENOENT" ||
          (e as NodeJS.ErrnoException).code === "EISDIR"
        )
          return json(404, "NOT_FOUND");
        throw e;
      }
    } catch {
      return json(500, "LOCAL_REQUEST_FAILED");
    }
  };
}
