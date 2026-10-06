import {
  parseProject,
  CoreError,
  type Project,
  type ProjectNode,
  type JSONValue,
} from "./project";
import { resolveTokens } from "./tokens";
import { resolveSceneNodes, definitionNodes } from "./design-components";
import type { LibraryMetadata } from "../library/sdk";
import { handoffRuntime } from "./handoff-runtime";
export type HandoffOptions = { pageId: string; revision: number };
export type HandoffDiagnostic = {
  code: string;
  nodeId?: string;
  message: string;
};
export type TokenReference = { path: string; token: string; value: JSONValue };

export function layerStyle(node: ProjectNode): Record<string, string | number> {
  const s = node.scene;
  if (!s)
    return {
      position: "relative",
      padding: 8,
      outline: "1px dashed #ddd",
      borderRadius: 6,
      marginBottom: 12,
    };
  return Object.fromEntries(
    Object.entries({
      position: "absolute",
      padding: 0,
      left: s.x,
      top: s.y,
      width: s.width,
      height: s.height,
      transform: `rotate(${s.rotation ?? 0}deg)`,
      transformOrigin: "0 0",
      opacity: s.opacity ?? 1,
      overflow: s.clip ? "hidden" : "visible",
      background: s.kind === "text" ? undefined : s.fill,
      color: s.kind === "text" ? s.fill : undefined,
      border:
        s.stroke && s.kind !== "vector"
          ? `${s.strokeWidth ?? 1}px solid ${s.stroke}`
          : undefined,
      borderRadius: s.radius ?? 0,
      boxSizing: "border-box",
    }).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number>;
}
function pageSnapshot(project: Project, options: HandoffOptions) {
  if (
    !options ||
    !Number.isInteger(options.revision) ||
    options.revision !== project.revision
  )
    throw new CoreError("REVISION_CONFLICT");
  const snapshot = parseProject(project);
  const page = snapshot.pages.find((page) => page.screenId === options.pageId);
  if (!page) throw new CoreError("PAGE_NOT_FOUND");
  return { snapshot, page };
}
export function tokenReferences(
  value: unknown,
  tokens: Record<string, JSONValue>,
  path = "props",
): TokenReference[] {
  if (!value || typeof value !== "object") return [];
  if ("$token" in value) {
    const token = String((value as { $token: unknown }).$token);
    return [{ path, token, value: tokens[token] }];
  }
  return Object.entries(value).flatMap(([key, row]) =>
    tokenReferences(
      row,
      tokens,
      Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`,
    ),
  );
}
function resolveProps(
  value: unknown,
  tokens: Record<string, JSONValue>,
): unknown {
  if (!value || typeof value !== "object") return value;
  if ("$token" in value)
    return tokens[String((value as { $token: unknown }).$token)];
  if (Array.isArray(value))
    return value.map((row) => resolveProps(row, tokens));
  return Object.fromEntries(
    Object.entries(value).map(([key, row]) => [key, resolveProps(row, tokens)]),
  );
}
export function inspectModel(
  project: Project,
  options: HandoffOptions & { nodeId: string },
  libraries: LibraryMetadata[],
) {
  const { snapshot, page } = pageSnapshot(project, options);
  const nodes = resolveSceneNodes(snapshot, page.nodes),
    node = definitionNodes(nodes).get(options.nodeId);
  if (!node) throw new CoreError("NODE_NOT_FOUND");
  const library = libraries.find(
    (library) =>
      library.id === snapshot.library.id &&
      library.version === snapshot.library.version,
  );
  const definition =
    library && Object.hasOwn(library.components, node.type)
      ? library.components[node.type]
      : undefined;
  const tokens = resolveTokens(snapshot.tokens, snapshot.theme);
  const props = { ...definition?.defaultProps, ...node.props };
  return {
    revision: snapshot.revision,
    pageId: page.screenId,
    nodeId: node.id,
    node: {
      ...node,
      slots: Object.fromEntries(
        Object.entries(node.slots).map(([slot, rows]) => [
          slot,
          rows.map((child) => child.id),
        ]),
      ),
    },
    modelStyle: layerStyle(node),
    props,
    resolvedProps: resolveProps(props, tokens) as Record<string, JSONValue>,
    tokenRefs: tokenReferences(props, tokens),
    component: definition
      ? {
          libraryId: library!.id,
          version: library!.version,
          type: node.type,
          name: definition.name,
          category: definition.category ?? null,
          support: definition.support ?? "rendered",
        }
      : null,
    localDefinition:
      project.pages
        .flatMap((page) => [...definitionNodes(page.nodes).values()])
        .find((source) => source.id === options.nodeId)?.instance ?? null,
  };
}
export function createReactHandoff(
  project: Project,
  options: HandoffOptions,
  libraries: LibraryMetadata[],
) {
  const { snapshot, page } = pageSnapshot(project, options);
  const library = libraries.find(
    (library) =>
      library.id === snapshot.library.id &&
      library.version === snapshot.library.version,
  );
  const diagnostics: HandoffDiagnostic[] = [];
  if (!library)
    diagnostics.push({
      code: "MISSING_LIBRARY",
      message: `Required trusted library ${snapshot.library.id}@${snapshot.library.version}`,
    });
  const tokens = resolveTokens(snapshot.tokens, snapshot.theme),
    assetPaths = new Set<string>(),
    components = new Map<
      string,
      { type: string; name: string; fields: string[]; fixtures: string[] }
    >();
  const refs: Record<string, TokenReference[]> = {};
  function assets(value: unknown) {
    if (
      typeof value === "string" &&
      /^assets\/[a-f0-9]{64}\.(png|svg)$/.test(value)
    )
      assetPaths.add(value);
    else if (value && typeof value === "object")
      Object.values(value).forEach(assets);
  }
  function map(nodes: ProjectNode[]): unknown[] {
    return nodes.map((node) => {
      const definition =
        library && Object.hasOwn(library.components, node.type)
          ? library.components[node.type]
          : undefined;
      const primitive =
        (node.scene &&
          ["frame", "text", "vector", "image"].includes(node.scene.kind)) ||
        node.type === "StudioImage" ||
        node.type === "SceneFrame";
      if (!node.hidden && !primitive && !definition)
        diagnostics.push({
          code: "UNREGISTERED_COMPONENT",
          nodeId: node.id,
          message: `Component ${node.type} is not registered in the required library`,
        });
      if (!node.hidden && definition?.support === "requires-context")
        diagnostics.push({
          code: "REQUIRES_CONTEXT",
          nodeId: node.id,
          message: `${node.type} requires its product providers/context`,
        });
      if (definition)
        components.set(node.type, {
          type: node.type,
          name: definition.name,
          fields: Object.keys(definition.fields),
          fixtures: definition.fixtures.map((fixture) => fixture.name),
        });
      const raw = { ...definition?.defaultProps, ...node.props },
        props = resolveProps(raw, tokens);
      refs[node.id] = tokenReferences(raw, tokens);
      assets(props);
      return {
        ...node,
        props,
        style: layerStyle(node),
        slots: Object.fromEntries(
          Object.entries(node.slots).map(([slot, rows]) => [slot, map(rows)]),
        ),
      };
    });
  }
  const nodes = map(resolveSceneNodes(snapshot, page.nodes));
  const variables: Record<string, string> = {};
  for (const token of library?.tokens ?? [])
    variables[token.name] = token.themes?.[snapshot.theme] ?? token.value;
  for (const [name, value] of Object.entries(tokens))
    variables[name.startsWith("--") ? name : "--" + name] = String(value);
  const theme = library?.themes.find((theme) => theme.id === snapshot.theme);
  if (library && !theme)
    diagnostics.push({
      code: "MISSING_THEME",
      message: `Theme ${snapshot.theme} is not registered`,
    });
  const requirements = [
    "React 18 or newer and react-dom",
    `Explicit trusted runtime ${snapshot.library.id}@${snapshot.library.version} supplied as Screen.library`,
    "Required library CSS, local fonts and product providers must be supplied by the integrator",
    "Copy manifest assets beneath assets/ using their content hashes",
    "Snapshot of supported geometry and component props only; application routes, data loading, actions and editor state are not generated",
  ];
  const manifest = {
    version: 1,
    projectId: snapshot.projectId,
    pageId: page.screenId,
    revision: snapshot.revision,
    viewport: page.viewport,
    requiredLibrary: snapshot.library,
    theme: snapshot.theme,
    components: [...components.values()],
    tokenRefs: refs,
    assets: [...assetPaths].sort(),
    requirements,
    diagnostics,
  };
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  const tokenCSS = Object.entries(variables)
    .filter(([name]) => /^--[\w.-]+$/.test(name))
    .map(([name, value]) => {
      const token = snapshot.tokens[name] ?? snapshot.tokens[name.slice(2)];
      return `  ${name.replaceAll(".", "\\.")}: ${token?.type === "string" ? JSON.stringify(value) : value};`;
    })
    .join("\n");
  const files: Record<string, string> = {
    "Screen.tsx": `import { useEffect } from "react";\nimport { RenderNodes, type HandoffNode, type RegisteredLibrary } from "./Runtime";\nimport "./styles.css";\nimport "./tokens.css";\nconst nodes=${JSON.stringify(nodes)} as HandoffNode[];\nconst expected=${JSON.stringify(snapshot.library)};\nconst variables=${JSON.stringify(variables)};\nconst theme=${JSON.stringify(theme ?? {})} as {className?:string;attributes?:Record<string,string>};\nexport function Screen({library}:{library:RegisteredLibrary}){\n  useEffect(()=>{document.documentElement.className=theme.className??"";for(const [key,value] of Object.entries((theme as {attributes?:Record<string,string>}).attributes??{}))document.documentElement.setAttribute(key,value);for(const [key,value] of Object.entries(variables))document.body.style.setProperty(key,value)},[]);\n  return <main className="studio-handoff"><RenderNodes nodes={nodes} library={library} expected={expected}/></main>;\n}\n`,
    "Runtime.tsx": handoffRuntime,
    "styles.css":
      "html,body{margin:0;min-height:100vh;box-sizing:border-box;background:var(--bg,#fff);color:var(--text-primary,#17202c);font-family:system-ui,sans-serif}body{padding:20px}.studio-handoff{display:flow-root}\n",
    "tokens.css": `:root {\n${tokenCSS}\n}\n`,
    "tokens.json": json({
      theme: snapshot.theme,
      tokens: snapshot.tokens,
      resolved: tokens,
    }),
    "manifest.json": json(manifest),
    "package.json": json({
      name: "studio-handoff",
      version: "0.0.0",
      private: true,
      type: "module",
      peerDependencies: { react: ">=18", "react-dom": ">=18" },
    }),
    "README.md": `# React handoff\n\nRevision ${snapshot.revision}, page ${page.screenId}.\n\nImport Screen and pass the explicitly trusted library matching ${snapshot.library.id}@${snapshot.library.version}. Import required library CSS/fonts/providers and copy manifest assets.\n\n${requirements.map((requirement) => "- " + requirement).join("\n")}\n\n${diagnostics.map((diagnostic) => "- " + diagnostic.code + ": " + diagnostic.message).join("\n")}\n\nGeometry follows the studio's CSS-pixel contract. Selection outlines, locks, comments and interactive product state are not application behavior. This artifact is a starting point for integration, not production application code.\n`,
  };
  return {
    revision: snapshot.revision,
    pageId: page.screenId,
    supported: diagnostics.length === 0,
    files,
    assetPaths: [...assetPaths].sort(),
    manifest,
    requirements,
    diagnostics,
  };
}
