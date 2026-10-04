import { toCoreTokens, type LibraryMetadata } from "../library/sdk";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, open, rename, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ProjectStore } from "../core/store";
import type { Project } from "../core/project";
import { batchSchema, projectSchema, validateComponentProps } from "./schema";
import { applyBatch, type Batch } from "../core/operations";
import { writeSVGAsset, readSVGAsset } from "./assets";

export interface StudioOptions {
  root: string;
  initialProject?: Project;
  token?: string;
  port?: number;
  allowedOrigins?: string[];
  libraryMetadata?: unknown;
  autoApply?: boolean;
}
type Proposal = {
  id: string;
  batch: Batch;
  description: string;
  status: "pending" | "approved" | "applied";
  createdAt: string;
  resultRevision?: number;
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const secret = () => randomBytes(32).toString("hex");
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req: IncomingMessage) {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString() || "{}");
  } catch {
    throw new HttpError(400, "INVALID_JSON");
  }
}
async function atomic(path: string, value: unknown) {
  const temp = path + "." + randomUUID() + ".tmp";
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
  const directory = await open(join(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function rejectSymlink(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("UNSAFE_SYMLINK");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
export async function createStudioServer(options: StudioOptions) {
  const defaultLibrary = Array.isArray(options.libraryMetadata)
    ? (options.libraryMetadata.at(-1) as LibraryMetadata | undefined)
    : undefined;
  await rejectSymlink(options.root);
  const dir = join(options.root, ".studio");
  await rejectSymlink(dir);
  for (const file of [
    "connection.json",
    "ui-connection.json",
    "proposals.json",
    "audit.json",
  ])
    await rejectSymlink(join(dir, file));
  const store = await ProjectStore.open(options.root, {
    initialProject: options.initialProject ?? {
      schemaVersion: 2,
      projectId: randomUUID(),
      name: "Untitled",
      revision: 0,
      pages: [
        {
          screenId: "home",
          name: "Home",
          viewport: { width: 1200 },
          nodes: [],
        },
      ],
      library: defaultLibrary
        ? {
            id: defaultLibrary.id,
            version: defaultLibrary.version,
          }
        : { id: "builtin", version: "1" },
      theme: defaultLibrary?.themes?.[0]?.id ?? "light",
      tokens:
        defaultLibrary && Array.isArray(defaultLibrary.tokens)
          ? toCoreTokens(defaultLibrary)
          : {},
    },
  });
  const token = options.token ?? secret(),
    uiToken = secret();
  const origins = options.allowedOrigins ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5178",
    "http://127.0.0.1:5178",
    "http://localhost:5198",
    "http://127.0.0.1:5198",
  ];
  let proposals: Proposal[] = [];
  let audit: unknown[] = [];
  try {
    proposals = JSON.parse(await readFile(join(dir, "proposals.json"), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      await store.close();
      throw e;
    }
  }
  try {
    audit = JSON.parse(await readFile(join(dir, "audit.json"), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      await store.close();
      throw e;
    }
  }
  let context: Record<string, unknown> | null = null;
  let contextTime = 0;
  let serial = Promise.resolve();
  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const host = req.headers.host ?? "";
        if (!/^((127\.0\.0\.1)|(localhost)|(\[::1\])):\d+$/.test(host))
          throw new HttpError(403, "INVALID_HOST");
        const origin = req.headers.origin;
        if (origin && !origins.includes(origin))
          throw new HttpError(403, "INVALID_ORIGIN");
        if (!equal(req.headers.authorization ?? "", `Bearer ${token}`))
          throw new HttpError(401, "UNAUTHORIZED");
        const path = (req.url ?? "").split("?")[0];
        if (path.includes("%") || path.includes("..") || path.includes("\\"))
          throw new HttpError(400, "INVALID_PATH");
        if (req.method === "GET") {
          if (path.startsWith("/api/assets/")) {
            const bytes = await readSVGAsset(options.root, path.slice(12));
            res.writeHead(200, {
              "Content-Type": "image/svg+xml",
              "Content-Security-Policy": "default-src 'none'; sandbox",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=31536000, immutable",
            });
            res.end(bytes);
            return;
          }
          if (path === "/api/project") return send(res, 200, store.read());
          if (path === "/api/components")
            return send(res, 200, options.libraryMetadata ?? []);
          if (path === "/api/tokens")
            return send(res, 200, store.read().tokens);
          if (path === "/api/context")
            return send(res, 200, {
              connected: Date.now() - contextTime < 15000,
              context: Date.now() - contextTime < 15000 ? context : null,
              expiresAfterMs: 15000,
            });
          if (path === "/api/proposals") return send(res, 200, proposals);
          if (path.startsWith("/api/proposals/")) {
            const proposal = proposals.find((p) => p.id === path.slice(15));
            if (!proposal) throw new HttpError(404, "NOT_FOUND");
            return send(res, 200, proposal);
          }
          if (path === "/api/capabilities")
            return send(res, 200, {
              schemaVersion: 2,
              proposalApproval: "ui",
              autoApply: options.autoApply === true,
              contextTTL: 15000,
              allowedOrigins: origins,
              operations: true,
              undo: true,
              redo: true,
            });
          if (path === "/api/schema")
            return send(res, 200, {
              schemaVersion: 2,
              project: projectSchema,
              batch: batchSchema,
            });
          throw new HttpError(404, "NOT_FOUND");
        }
        if (req.method !== "POST")
          throw new HttpError(405, "METHOD_NOT_ALLOWED");
        const data = await body(req);
        const task = serial.then(async () => {
          if (path === "/api/assets") {
            if (
              !origin ||
              !origins.includes(origin) ||
              !equal(String(req.headers["x-studio-ui-token"] ?? ""), uiToken)
            )
              throw new HttpError(403, "UI_AUTHORIZATION_REQUIRED");
            return writeSVGAsset(options.root, data.svg);
          }
          if (path === "/api/context") {
            if (
              typeof data.clientId !== "string" ||
              typeof data.pageId !== "string" ||
              !Array.isArray(data.selectedIds)
            )
              throw new HttpError(400, "INVALID_CONTEXT");
            context = data;
            contextTime = data.connected === false ? 0 : Date.now();
            return data;
          }
          if (path === "/api/operations") {
            if (
              !origin ||
              !origins.includes(origin) ||
              !equal(String(req.headers["x-studio-ui-token"] ?? ""), uiToken)
            )
              throw new HttpError(403, "UI_AUTHORIZATION_REQUIRED");
            if (data.baseRevision === store.read().revision)
              validateComponentProps(
                applyBatch(store.read(), data),
                options.libraryMetadata,
              );
            return store.apply(data);
          }
          if (path === "/api/undo" || path === "/api/redo")
            return path.endsWith("undo")
              ? store.undo(data.requestId, data.baseRevision)
              : store.redo(data.requestId, data.baseRevision);
          if (path === "/api/proposals") {
            if (
              !data.batch ||
              typeof data.batch.requestId !== "string" ||
              !Array.isArray(data.batch.operations) ||
              data.batch.operations.length === 0
            )
              throw new HttpError(400, "INVALID_PROPOSAL");
            const existing = proposals.find(
              (p) => p.batch.requestId === data.batch.requestId,
            );
            if (existing) {
              if (JSON.stringify(existing.batch) !== JSON.stringify(data.batch))
                throw new HttpError(409, "REQUEST_ID_REUSED");
              return existing;
            }
            validateComponentProps(
              applyBatch(store.read(), data.batch),
              options.libraryMetadata,
            );
            const p: Proposal = {
              id: randomUUID(),
              batch: data.batch,
              description: String(data.description ?? ""),
              status: options.autoApply ? "approved" : "pending",
              createdAt: new Date().toISOString(),
            };
            const next = [...proposals, p];
            await atomic(join(dir, "proposals.json"), next);
            proposals = next;
            return p;
          }
          const match = path.match(
            /^\/api\/proposals\/([^/]+)\/(approve|apply)$/,
          );
          if (match) {
            const p = proposals.find((p) => p.id === match[1]);
            if (!p) throw new HttpError(404, "NOT_FOUND");
            if (match[2] === "approve") {
              if (
                !origin ||
                !origins.includes(origin) ||
                !equal(String(req.headers["x-studio-ui-token"] ?? ""), uiToken)
              )
                throw new HttpError(403, "UI_APPROVAL_REQUIRED");
              const approved = {
                ...p,
                status:
                  p.status === "applied"
                    ? ("applied" as const)
                    : ("approved" as const),
              };
              const next = proposals.map((value) =>
                value.id === p.id ? approved : value,
              );
              const nextAudit = [
                ...audit,
                {
                  action: "approve",
                  proposalId: p.id,
                  at: new Date().toISOString(),
                },
              ];
              await atomic(join(dir, "audit.json"), nextAudit);
              audit = nextAudit;
              await atomic(join(dir, "proposals.json"), next);
              proposals = next;
              return approved;
            }
            if (p.status === "pending")
              throw new HttpError(403, "PROPOSAL_NOT_APPROVED");
            const project = await store.apply(p.batch);
            const applied = {
              ...p,
              status: "applied" as const,
              resultRevision: project.revision,
            };
            const next = proposals.map((value) =>
              value.id === p.id ? applied : value,
            );
            const nextAudit = [
              ...audit,
              {
                action: "apply",
                proposalId: p.id,
                requestId: p.batch.requestId,
                revision: project.revision,
                at: new Date().toISOString(),
              },
            ];
            await atomic(join(dir, "audit.json"), nextAudit);
            audit = nextAudit;
            await atomic(join(dir, "proposals.json"), next);
            proposals = next;
            return project;
          }
          throw new HttpError(404, "NOT_FOUND");
        });
        serial = task.then(
          () => undefined,
          () => undefined,
        );
        send(res, 200, await task);
      } catch (error) {
        const e = error as Error & { code?: string; status?: number };
        send(
          res,
          e.status ??
            (e.code === "ENOENT"
              ? 404
              : e.message === "ASSET_TOO_LARGE"
                ? 413
                : e.code?.includes("REVISION")
                  ? 409
                  : 400),
          {
            error: e.code ?? e.message,
          },
        );
      }
    })();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 5190, "127.0.0.1", resolve);
    });
  } catch (e) {
    await store.close();
    throw e;
  }
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 5190}`;
  try {
    await atomic(join(dir, "ui-connection.json"), {
      url,
      uiToken,
      pid: process.pid,
    });
    await atomic(join(dir, "connection.json"), {
      url,
      token,
      pid: process.pid,
    });
  } catch (e) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.close();
    throw e;
  }
  return {
    server,
    url,
    token,
    uiToken,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await serial;
      await unlink(join(dir, "connection.json")).catch(() => {});
      await unlink(join(dir, "ui-connection.json")).catch(() => {});
      await store.close();
    },
  };
}
