import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createStudioServer } from "./server";
import { batchSchema } from "./schema";
import { readProjectPage } from "./read";
import { getConfiguredLibraryMetadata } from "../../scripts/library/plugin";
const args = process.argv.slice(2),
  at = args.indexOf("--project");
if (at < 0 || !args[at + 1])
  throw new Error("MCP requires explicit --project <directory>");
const root = resolve(args[at + 1]);
let owner: Awaited<ReturnType<typeof createStudioServer>> | undefined;
let connection: { url: string; token: string; pid?: number };
let ownerDead = false;
try {
  for (const path of [root, join(root, ".studio")]) {
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error("UNSAFE_SYMLINK");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const path = join(root, ".studio/connection.json");
  if ((await lstat(path)).isSymbolicLink()) throw new Error("UNSAFE_SYMLINK");
  connection = JSON.parse(await readFile(path, "utf8"));
  if (!Number.isInteger(connection.pid) || connection.pid! <= 0)
    throw new Error("INVALID_CONNECTION");
  try {
    process.kill(connection.pid!, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") ownerDead = true;
    throw e;
  }
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
  const response = await fetch(connection.url + "/api/project", {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("OWNER_UNAVAILABLE");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT" && !ownerDead) throw e;
  owner = await createStudioServer({
    root,
    port: 0,
    autoApply: process.env.STUDIO_AUTO_APPLY === "1",
    libraryMetadata: getConfiguredLibraryMetadata({
      externalRoot: process.env.STUDIO_LIBRARY_ROOT,
    }),
  });
  connection = { url: owner.url, token: owner.token };
}
const object = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const str = { type: "string" },
  integer = { type: "integer", minimum: 0 };
const tools = [
  {
    name: "schema_read",
    description: "Read canonical project and operation JSON schemas.",
    inputSchema: object(),
  },
  {
    name: "capabilities_read",
    description: "Read owner capabilities and approval policy.",
    inputSchema: object(),
  },
  {
    name: "project_read",
    description:
      "Read project metadata, partial page trees and stable flat node pages with parent/slot relationships. Use offset/nextOffset to read all nodes.",
    inputSchema: object({
      pageId: str,
      nodeId: str,
      offset: integer,
      limit: { type: "integer", minimum: 1, maximum: 500 },
    }),
  },
  {
    name: "pages_list",
    description: "List page metadata without nodes.",
    inputSchema: object(),
  },
  {
    name: "document_read",
    description:
      "Read a page with explicit flat node pagination and parent/slot relationships. Use nextOffset to continue.",
    inputSchema: object(
      {
        pageId: str,
        nodeId: str,
        offset: integer,
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      ["pageId"],
    ),
  },
  {
    name: "components_list",
    description: "Read component library metadata.",
    inputSchema: object(),
  },
  {
    name: "editor_context",
    description: "Read active editor context and explicit connection status.",
    inputSchema: object(),
  },
  {
    name: "tokens_read",
    description: "Read named tokens and themes.",
    inputSchema: object(),
  },
  {
    name: "proposal_create",
    description:
      "Create a durable proposal for user review. Cannot grant approval.",
    inputSchema: {
      ...object({ batch: batchSchema, description: str }, ["batch"]),
      $defs: batchSchema.$defs,
    },
  },
  {
    name: "proposal_read",
    description: "Read a proposal or all proposals.",
    inputSchema: object({ id: str }),
  },
  {
    name: "proposal_apply",
    description:
      "Apply an already UI-approved proposal. Pending proposals are rejected.",
    inputSchema: object({ id: str }, ["id"]),
  },
  {
    name: "undo",
    description: "Undo one transaction at the specified revision.",
    inputSchema: object({ requestId: str, baseRevision: integer }, [
      "requestId",
      "baseRevision",
    ]),
  },
];
const server = new Server(
  { name: "local-design-studio", version: "0.0.1" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
async function request(path: string, body?: unknown) {
  const r = await fetch(connection.url + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error ?? `HTTP_${r.status}`);
  return result;
}
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const a = req.params.arguments ?? {};
    let result: unknown;
    switch (req.params.name) {
      case "project_read":
      case "document_read":
      case "pages_list": {
        const p = await request("project");
        if (req.params.name === "pages_list") {
          result = {
            ...p,
            pages: p.pages.map((page: any) => ({
              screenId: page.screenId,
              name: page.name,
              viewport: page.viewport,
            })),
          };
          break;
        }
        result = readProjectPage(p, {
          pageId: typeof a.pageId === "string" ? a.pageId : undefined,
          nodeId: typeof a.nodeId === "string" ? a.nodeId : undefined,
          offset: typeof a.offset === "number" ? a.offset : undefined,
          limit: typeof a.limit === "number" ? a.limit : undefined,
        });
        break;
      }
      case "schema_read":
        result = await request("schema");
        break;
      case "capabilities_read":
        result = await request("capabilities");
        break;
      case "components_list":
        result = await request("components");
        break;
      case "editor_context":
        result = await request("context");
        break;
      case "tokens_read":
        result = await request("tokens");
        break;
      case "proposal_create":
        result = await request("proposals", {
          batch: a.batch,
          description: a.description,
        });
        break;
      case "proposal_read":
        result = await request(
          "proposals" + (a.id ? "/" + encodeURIComponent(String(a.id)) : ""),
        );
        break;
      case "proposal_apply":
        result = await request(
          "proposals/" + encodeURIComponent(String(a.id)) + "/apply",
          {},
        );
        break;
      case "undo":
        result = await request("undo", {
          requestId: a.requestId,
          baseRevision: a.baseRevision,
        });
        break;
      default:
        throw new Error("UNKNOWN_TOOL");
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ error: (e as Error).message }) },
      ],
    };
  }
});
await server.connect(new StdioServerTransport());
const stop = async () => {
  await server.close();
  await owner?.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.stdin.on("end", () => void stop());
