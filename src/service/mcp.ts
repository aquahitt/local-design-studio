import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { createStudioServer } from "./server";
import { batchSchema, projectSchema } from "./schema";
import { renderSnapshot } from "./render";
import { readAnnotations } from "../core/annotations";
import { readImageAsset } from "./image-assets";
import {
  readProjectPage,
  readComponents,
  readComponent,
  readPages,
} from "./read";
import {
  readOwnerConnection,
  createOwnerRequest,
  OwnerRequestError,
  type OwnerConnection,
} from "./connection";
import { getConfiguredLibraryMetadata } from "../../scripts/library/plugin";
const args = process.argv.slice(2),
  at = args.indexOf("--project");
if (at < 0 || !args[at + 1])
  throw new Error("MCP requires explicit --project <directory>");
const root = resolve(args[at + 1]);
let owner: Awaited<ReturnType<typeof createStudioServer>> | undefined;
let connection: OwnerConnection;
try {
  connection = await readOwnerConnection(root);
} catch (e) {
  if ((e as Error).message !== "OWNER_NOT_RUNNING") throw e;
  owner = await createStudioServer({
    root,
    port: 0,
    autoApply: process.env.STUDIO_AUTO_APPLY === "1",
    renderSnapshot: (project, options) =>
      renderSnapshot(project, options, {
        externalRoot: process.env.STUDIO_LIBRARY_ROOT,
        readAsset: (name) => readImageAsset(root, name),
      }),
    libraryMetadata: getConfiguredLibraryMetadata({
      externalRoot: process.env.STUDIO_LIBRARY_ROOT,
    }),
  });
  connection = { url: owner.url, token: owner.token, pid: process.pid };
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
    name: "inspect_read",
    description:
      "Read model geometry, token references, registered component mapping and actual browser-computed styles/bounds at a revision. Missing styles are explicit diagnostics.",
    inputSchema: object({ pageId: str, revision: integer, nodeId: str }, [
      "pageId",
      "revision",
      "nodeId",
    ]),
  },
  {
    name: "react_export",
    description:
      "Export a reviewable React/CSS/tokens/assets file map for one registered page. Exact trusted runtime must be supplied separately; unsupported mappings are explicit diagnostics.",
    inputSchema: object({ pageId: str, revision: integer }, [
      "pageId",
      "revision",
    ]),
  },
  {
    name: "annotations_read",
    description:
      "Read portable page/node discussions and decisions with computed orphaned-anchor status. Changes use proposal_create with setAnnotations; approval remains in the UI.",
    inputSchema: object({
      pageId: str,
      nodeId: str,
      status: { enum: ["open", "resolved"] },
      orphaned: { type: "boolean" },
      offset: integer,
      limit: { type: "integer", minimum: 1, maximum: 500 },
    }),
  },
  {
    name: "document_render",
    description:
      "Capture a read-only PNG of one page or node at an explicit revision using the owner's real component renderer. Returns native image plus viewport, bounds and warnings.",
    inputSchema: object(
      {
        pageId: str,
        revision: integer,
        nodeId: str,
        theme: str,
        viewport: projectSchema.$defs.page.properties.viewport,
      },
      ["pageId", "revision"],
    ),
  },
  {
    name: "components_list",
    description:
      "List compact component summaries (field names only), with optional library, category and name filters and pagination. Use component_read for full schema.",
    inputSchema: object({
      libraryId: str,
      category: str,
      query: str,
      offset: integer,
      limit: { type: "integer", minimum: 1, maximum: 500 },
    }),
  },
  {
    name: "component_read",
    description:
      "Read the complete schema, fixtures and defaults for one component.",
    inputSchema: object({ libraryId: str, id: str }, ["libraryId", "id"]),
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
const request = createOwnerRequest(root, connection);
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
          result = readPages(p);
          break;
        }
        result = readProjectPage(
          p,
          {
            pageId: typeof a.pageId === "string" ? a.pageId : undefined,
            nodeId: typeof a.nodeId === "string" ? a.nodeId : undefined,
            offset: typeof a.offset === "number" ? a.offset : undefined,
            limit: typeof a.limit === "number" ? a.limit : undefined,
          },
          req.params.name === "project_read",
        );
        break;
      }
      case "inspect_read":
        result = await request("inspect", a);
        break;
      case "react_export":
        result = await request("handoff", a);
        break;
      case "annotations_read":
        result = readAnnotations(await request("project"), a);
        break;
      case "document_render": {
        const rendered = await request("render", a);
        const { data, mimeType, ...metadata } = rendered;
        return {
          content: [
            { type: "image", data, mimeType },
            { type: "text", text: JSON.stringify(metadata) },
          ],
        };
      }
      case "schema_read":
        result = await request("schema");
        break;
      case "capabilities_read":
        result = await request("capabilities");
        break;
      case "components_list":
        result = readComponents(await request("components"), a);
        break;
      case "component_read":
        result = readComponent(
          await request("components"),
          String(a.libraryId),
          String(a.id),
        );
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
        {
          type: "text",
          text: JSON.stringify(
            e instanceof OwnerRequestError
              ? e.details
              : { error: (e as Error).message },
          ),
        },
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
