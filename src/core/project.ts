import { parseViewport, type Viewport } from "./viewport";
import {
  CoreError,
  resolveTokens,
  type Tokens,
  type JSONRecord,
  type JSONValue,
} from "./tokens";
export { CoreError };
export type { JSONRecord, JSONValue, Tokens };
export type ProjectNode = {
  id: string;
  type: string;
  props: JSONRecord;
  slots: Record<string, ProjectNode[]>;
};
export type ProjectPage = {
  screenId: string;
  name: string;
  viewport: Viewport;
  nodes: ProjectNode[];
};
export type ProjectGroup = {
  id: string;
  name: string;
  pages: string[];
  components: string[];
  tokens: string[];
};
export type Project = {
  schemaVersion: 2;
  projectId: string;
  name: string;
  revision: number;
  pages: ProjectPage[];
  library: { id: string; version: string };
  theme: string;
  tokens: Tokens;
  groups?: ProjectGroup[];
};
export const PROJECT_LIMITS = {
  bytes: 5_000_000,
  nodes: 10_000,
  depth: 64,
  pages: 100,
};
export function stableStringify(input: unknown): string {
  const seen = new Set<object>();
  function sorted(v: unknown, depth = 0): unknown {
    if (depth > 256) throw new CoreError("MAX_DEPTH");
    if (v === null || typeof v !== "object") {
      if (
        (typeof v === "number" && !Number.isFinite(v)) ||
        typeof v === "function" ||
        typeof v === "undefined" ||
        typeof v === "bigint"
      )
        throw new CoreError("INVALID_JSON");
      return v;
    }
    if (seen.has(v)) throw new CoreError("CYCLE");
    seen.add(v);
    const result = Array.isArray(v)
      ? v.map((x) => sorted(x, depth + 1))
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [
              k,
              sorted((v as Record<string, unknown>)[k], depth + 1),
            ]),
        );
    seen.delete(v);
    return result;
  }
  return JSON.stringify(sorted(input));
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new CoreError("INVALID_OBJECT");
  return v as Record<string, unknown>;
}
function string(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 1000)
    throw new CoreError("INVALID_STRING");
  return v;
}
function exact(v: Record<string, unknown>, keys: string[]) {
  if (Object.keys(v).some((k) => !keys.includes(k)))
    throw new CoreError("UNKNOWN_FIELD");
}
export function parseProject(input: unknown): Project {
  const serialized = stableStringify(input);
  if (new TextEncoder().encode(serialized).byteLength > PROJECT_LIMITS.bytes)
    throw new CoreError("PROJECT_TOO_LARGE");
  const p = object(JSON.parse(serialized));
  exact(p, [
    "schemaVersion",
    "projectId",
    "name",
    "revision",
    "pages",
    "library",
    "theme",
    "tokens",
    "groups",
  ]);
  if (p.schemaVersion !== 2) throw new CoreError("UNSUPPORTED_VERSION");
  if (!Number.isSafeInteger(p.revision) || (p.revision as number) < 0)
    throw new CoreError("INVALID_REVISION");
  const library = object(p.library);
  exact(library, ["id", "version"]);
  string(library.id);
  string(library.version);
  string(p.projectId);
  string(p.name);
  string(p.theme);
  const tokens = object(p.tokens) as Tokens;
  const resolvedTokens = resolveTokens(tokens, p.theme as string);
  // The default and every configured mode are validated even when inactive.
  // Resolving only the active theme could hide unsafe default or override values.
  const modes = new Set<string>([p.theme as string]);
  for (const token of Object.values(tokens))
    for (const theme of Object.keys(token.themes ?? {})) modes.add(theme);
  const tokenModes = [
    resolveTokens(tokens),
    ...Array.from(modes, (theme) => resolveTokens(tokens, theme)),
  ];
  const ids = new Set<string>();
  let count = 0;
  function json(v: JSONValue, key = "") {
    if (
      /^on[a-z]|^(?:__proto__|prototype|constructor|script|code|html|dangerouslysetinnerhtml)$/.test(
        key.toLowerCase(),
      )
    )
      throw new CoreError("EXECUTABLE_FIELD", key);
    if (v && typeof v === "object") {
      if (!Array.isArray(v) && "$token" in v) {
        if (
          Object.keys(v).length !== 1 ||
          typeof v.$token !== "string" ||
          !Object.hasOwn(tokens, v.$token)
        )
          throw new CoreError("MISSING_TOKEN");
        // Validate the resolved scalar using the original property's constraints,
        // while retaining the token reference in the canonical document.
        for (const values of tokenModes) json(values[v.$token as string], key);
        return;
      }
      for (const [k, value] of Object.entries(v)) json(value, k);
    }
    if (typeof v === "string" && /^\s*(javascript|vbscript|data):/i.test(v))
      throw new CoreError("UNSAFE_URL");
    if (
      typeof v === "string" &&
      /^(src|asset|assetRef)$/.test(key) &&
      (!v.startsWith("assets/") ||
        v.split("/").includes("..") ||
        v.includes("\\"))
    )
      throw new CoreError("UNSAFE_ASSET_REFERENCE");
  }
  function nodes(input: unknown, depth = 0): ProjectNode[] {
    if (depth > PROJECT_LIMITS.depth) throw new CoreError("MAX_DEPTH");
    if (!Array.isArray(input)) throw new CoreError("INVALID_NODES");
    return input.map((raw) => {
      const n = object(raw);
      exact(n, ["id", "type", "props", "slots"]);
      const id = string(n.id);
      if (ids.has(id)) throw new CoreError("DUPLICATE_ID", id);
      ids.add(id);
      if (++count > PROJECT_LIMITS.nodes) throw new CoreError("MAX_NODES");
      const type = string(n.type);
      const props = object(n.props) as JSONRecord;
      json(props);
      const slots = object(n.slots);
      const result: Record<string, ProjectNode[]> = {};
      for (const [name, children] of Object.entries(slots)) {
        if (!/^[\w-]+$/.test(name)) throw new CoreError("INVALID_SLOT");
        result[name] = nodes(children, depth + 1);
      }
      const known: Record<string, { fields: string[]; slots: string[] }> = {
        Stack: { fields: ["gap"], slots: ["content"] },
        Card: { fields: ["title"], slots: ["content"] },
        Text: { fields: ["text"], slots: [] },
        Button: { fields: ["label"], slots: [] },
        Metric: { fields: ["label", "value"], slots: [] },
      };
      const def = known[type];
      if (def && library.id === "builtin") {
        exact(props, def.fields);
        exact(slots, def.slots);
        for (const field of def.fields) {
          const v = props[field];
          if (
            v &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            "$token" in v
          ) {
            const token = tokens[v.$token as string];
            if (
              (field === "gap" &&
                !["number", "dimension"].includes(token.type)) ||
              (field !== "gap" &&
                !["string", "fontFamily"].includes(token.type))
            )
              throw new CoreError("TOKEN_TYPE_MISMATCH", field);
            if (
              field === "gap" &&
              (typeof resolvedTokens[v.$token as string] !== "number" ||
                (resolvedTokens[v.$token as string] as number) < 0 ||
                (resolvedTokens[v.$token as string] as number) > 64)
            )
              throw new CoreError("INVALID_PROP", field);
            continue;
          }
          if (
            field === "gap"
              ? typeof v !== "number" || v < 0 || v > 64
              : typeof v !== "string" || v.length > 1000
          )
            throw new CoreError("INVALID_PROP", field);
        }
        for (const slot of def.slots)
          if (!Object.hasOwn(slots, slot)) throw new CoreError("INVALID_SLOT");
      }
      return { id, type, props, slots: result };
    });
  }
  if (
    !Array.isArray(p.pages) ||
    !p.pages.length ||
    p.pages.length > PROJECT_LIMITS.pages
  )
    throw new CoreError("INVALID_PAGES");
  const pageIds = new Set<string>();
  const pages = p.pages.map((raw) => {
    const page = object(raw);
    exact(page, ["screenId", "name", "viewport", "nodes"]);
    const id = string(page.screenId);
    if (pageIds.has(id)) throw new CoreError("DUPLICATE_PAGE");
    pageIds.add(id);
    const viewport = parseViewport(page.viewport);
    return {
      screenId: id,
      name: string(page.name),
      viewport,
      nodes: nodes(page.nodes),
    };
  });
  if (p.groups !== undefined) {
    if (!Array.isArray(p.groups) || p.groups.length > 100)
      throw new CoreError("INVALID_GROUPS");
    const groupIds = new Set<string>();
    const names = new Set<string>();
    for (const raw of p.groups) {
      const group = object(raw);
      exact(group, ["id", "name", "pages", "components", "tokens"]);
      const id = string(group.id),
        name = string(group.name);
      if (
        id === "ungrouped" ||
        id.length > 100 ||
        name.length > 100 ||
        name !== name.trim() ||
        groupIds.has(id) ||
        names.has(name.toLocaleLowerCase())
      )
        throw new CoreError("INVALID_GROUP");
      groupIds.add(id);
      names.add(name.toLocaleLowerCase());
      for (const key of ["pages", "components", "tokens"] as const) {
        const entries = group[key];
        if (
          !Array.isArray(entries) ||
          entries.length > 10000 ||
          new Set(entries).size !== entries.length
        )
          throw new CoreError("INVALID_GROUP_MEMBERS");
        for (const entry of entries) {
          string(entry);
          if (
            (key === "pages" && !pageIds.has(entry)) ||
            (key === "tokens" && !Object.hasOwn(tokens, entry))
          )
            throw new CoreError("GROUP_MEMBER_NOT_FOUND");
        }
      }
    }
  }
  return { ...p, pages } as Project;
}
export function migrateProject(screen: unknown): Project {
  const s = object(screen);
  if (s.schemaVersion === 2) return parseProject(s);
  if (s.schemaVersion !== 1) throw new CoreError("UNSUPPORTED_VERSION");
  exact(s, [
    "schemaVersion",
    "screenId",
    "name",
    "revision",
    "viewport",
    "nodes",
  ]);
  return parseProject({
    schemaVersion: 2,
    projectId: `project-${string(s.screenId)}`,
    name: s.name,
    revision: s.revision,
    pages: [
      {
        screenId: s.screenId,
        name: s.name,
        viewport: s.viewport,
        nodes: s.nodes,
      },
    ],
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: {},
  });
}
export function projectDiagnostics(
  project: Project,
  knownTypes?: ReadonlySet<string>,
): { code: string; nodeId: string; message: string }[] {
  const known =
    knownTypes ??
    new Set(
      project.library.id === "builtin"
        ? ["Stack", "Card", "Text", "Button", "Metric"]
        : [],
    );
  const result: { code: string; nodeId: string; message: string }[] = [];
  function walk(nodes: ProjectNode[]) {
    for (const node of nodes) {
      if (!known.has(node.type))
        result.push({
          code: "UNKNOWN_COMPONENT",
          nodeId: node.id,
          message: `Unknown component: ${node.type}`,
        });
      Object.values(node.slots).forEach(walk);
    }
  }
  project.pages.forEach((p) => walk(p.nodes));
  return result;
}
