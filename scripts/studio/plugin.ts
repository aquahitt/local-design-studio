import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Plugin, ViteDevServer } from "vite";
import { connectStudioOwner } from "../../src/service/attach";
import { parseProject, type Project } from "../../src/core/project";
import { toCoreTokens, type LibraryMetadata } from "../../src/library/sdk";
import { renderSnapshot } from "../../src/service/render";
import { readImageAsset } from "../../src/service/image-assets";
export function initialProject(library: LibraryMetadata): Project {
  const candidates = ["Text", "Button", "Card"].filter(
    (t) => library.components[t],
  );
  const introType = candidates[0] ?? Object.keys(library.components)[0];
  const props = structuredClone(
    library.components[introType]?.defaultProps ?? {},
  );
  return parseProject({
    schemaVersion: 2,
    projectId: "design-system",
    name: library.name + " · дизайн-система",
    revision: 0,
    library: { id: library.id, version: library.version },
    theme: library.themes[0]?.id ?? "light",
    tokens: toCoreTokens(library),
    pages: [
      {
        screenId: "overview",
        name: "Компоненты проекта",
        viewport: { width: 390 },
        nodes: [{ id: "intro", type: introType, props, slots: {} }],
      },
    ],
  });
}
export function studioServicePlugin({
  projectRoot,
  metadata,
}: {
  projectRoot: string;
  metadata: LibraryMetadata[];
}): Plugin {
  return {
    name: "studio-local-owner",
    configureServer(vite: ViteDevServer) {
      if (process.env.VITEST) return;
      const port = vite.config.server.port ?? 5173;
      const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
      const owner = connectStudioOwner({
        root: resolve(projectRoot),
        port: 0,
        allowedOrigins: origins,
        libraryMetadata: metadata,
        initialProject: initialProject(metadata.at(-1)!),
        autoApply: process.env.STUDIO_AUTO_APPLY === "1",
        renderSnapshot: (project, options) => renderSnapshot(project, options, {
          externalRoot: process.env.STUDIO_LIBRARY_ROOT,
          readAsset: (name) => readImageAsset(resolve(projectRoot), name),
        }),
      });
      owner.catch((error) =>
        vite.config.logger.error("Studio owner: " + error.message),
      );
      vite.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        const asset = /^\/assets\/[a-f0-9]{64}\.(svg|png)$/.test(pathname);
        if (!pathname.startsWith("/api/") && !asset) return next();
        if (
          !origins.some(
            (origin) => new URL(origin).host === req.headers.host,
          ) ||
          (req.headers.origin && !origins.includes(req.headers.origin)) ||
          req.headers["sec-fetch-site"] === "cross-site"
        ) {
          res.statusCode = 403;
          res.end("INVALID_ORIGIN");
          return;
        }
        try {
          const studio = await owner;
          if (pathname === "/api/session") {
            if (req.method !== "GET") {
              res.statusCode = 405;
              res.end();
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.end(
              JSON.stringify({ token: studio.token, uiToken: studio.uiToken }),
            );
            return;
          }
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers))
            if (
              typeof value === "string" &&
              !["host", "connection", "content-length"].includes(key)
            )
              headers[key] = value;
          if (asset) {
            if (req.method !== "GET") {
              res.statusCode = 405;
              res.end();
              return;
            }
            headers.authorization = `Bearer ${studio.token}`;
          }
          const parts: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > (pathname === "/api/assets" ? 12 * 1024 * 1024 : 1024 * 1024)) {
              res.statusCode = 413;
              res.end("PAYLOAD_TOO_LARGE");
              return;
            }
            parts.push(chunk);
          }
          const reply = await fetch(
            studio.url + (asset ? "/api" + pathname : (req.url ?? "")),
            {
              method: req.method,
              headers,
              body: ["GET", "HEAD"].includes(req.method ?? "GET")
                ? undefined
                : Buffer.concat(parts),
            },
          );
          res.statusCode = reply.status;
          res.setHeader(
            "Content-Type",
            reply.headers.get("content-type") ?? "application/json",
          );
          res.setHeader("Cache-Control", "no-store");
          const csp = reply.headers.get("content-security-policy");
          if (csp) res.setHeader("Content-Security-Policy", csp);
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.end(Buffer.from(await reply.arrayBuffer()));
        } catch (error) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      });
      let closing = false;
      vite.httpServer?.once("close", () => {
        if (closing) return;
        closing = true;
        void owner.then((s) => s.close()).catch(() => {});
      });
    },
  };
}
