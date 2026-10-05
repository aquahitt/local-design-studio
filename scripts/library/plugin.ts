import { studioLibrary } from "../../src/library/studio";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { isAbsolute, resolve, relative, join, dirname } from "node:path";
import type { Plugin } from "vite";
import { builtinLibrary } from "../../src/library/builtin";
import { exampleLibrary } from "../../src/library/example";
import {
  libraryMetadata,
  validateLibraryMetadata,
  LIBRARY_SDK_VERSION,
  type FieldSchema,
  type LibraryMetadata,
} from "../../src/library/sdk";
import { createLocalMetadata } from "../../src/library/localCatalog";
export interface LibraryConfig {
  externalRoot?: string;
  studioOnly?: boolean;
}
interface LocalInspection {
  root: string;
  metadata: LibraryMetadata;
  modules: Record<string, { path: string; exportName: string }>;
  css: string;
  entry?: { path: string; exportName: string };
}
function inspectLocal(config: LibraryConfig): LocalInspection | undefined {
  if (!config.externalRoot) return;
  if (!isAbsolute(config.externalRoot))
    throw new Error(
      "Library root must be an absolute operator-configured path",
    );
  const root = realpathSync(config.externalRoot);
  function trusted(path: string): string {
    const file = realpathSync(join(root, path));
    const rel = relative(root, file);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Library source escaped configured root");
    return file;
  }
  if (existsSync(join(root, "studio.library.json"))) {
    const manifest = JSON.parse(
      readFileSync(trusted("studio.library.json"), "utf8"),
    ) as Record<string, unknown>;
    if (manifest.sdkVersion !== LIBRARY_SDK_VERSION)
      throw new Error(`Unsupported library SDK: ${manifest.sdkVersion}`);
    const { entry, exportName, ...metadata } = manifest;
    validateLibraryMetadata(metadata);
    if (!metadata.capabilities)
      throw new Error("Manifest must declare library capabilities");
    if (
      typeof entry !== "string" ||
      !entry ||
      isAbsolute(entry) ||
      entry.split(/[\\/]/).some((segment) => segment === "..") ||
      !/\.(tsx?|jsx?)$/.test(entry)
    )
      throw new Error(
        "Library manifest entry must be a relative JavaScript or TypeScript path within its configured root",
      );
    if (
      typeof exportName !== "string" ||
      !/^[$A-Z_a-z][$\w]*$/.test(exportName)
    )
      throw new Error("Invalid library manifest exportName");
    return {
      root,
      metadata,
      modules: {},
      css: "",
      entry: { path: trusted(entry), exportName },
    };
  }
  const entry = trusted("packages/ui/src/index.ts");
  const packageJson = JSON.parse(
    readFileSync(trusted("packages/ui/package.json"), "utf8"),
  );
  const source = readFileSync(entry, "utf8");
  const exports: NonNullable<LibraryMetadata["exports"]> = [];
  const modules: LocalInspection["modules"] = {};
  const fields: Record<string, Record<string, FieldSchema>> = {};
  for (const statement of source.matchAll(
    /export\s+(?!type\b)\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
  )) {
    const modulePath = resolve(dirname(entry), statement[2]);
    const file = [".tsx", ".ts", "/index.tsx", "/index.ts"]
      .map((ext) => modulePath + ext)
      .find(existsSync);
    if (!file) continue;
    const checked = trusted(relative(root, file));
    const text = readFileSync(checked, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const raw of statement[1].split(",")) {
      const item = raw.trim();
      if (!item || item.startsWith("type ")) continue;
      const parts = item.split(/\s+as\s+/);
      const exportName = parts[0];
      const name = parts[1] ?? exportName;
      const kind = name.startsWith("use")
        ? "hook"
        : /^[A-Z][a-z]/.test(name)
          ? "component"
          : /^[A-Z_0-9]+$/.test(name)
            ? "constant"
            : "utility";
      exports.push({ name, kind });
      if (kind !== "component") continue;
      modules[name] = { path: checked, exportName };
      fields[name] = {};
      const body =
        text.match(
          new RegExp("interface " + name + "Props[^\\{]*\\{([^}]+)\\}"),
        )?.[1] ?? "";
      for (const property of body.matchAll(
        /([\w-]+|"[^"\n]+")\??\s*:\s*([^;]+);/g,
      )) {
        const key = property[1].replace(/^"|"$/g, "");
        const type = property[2].trim();
        if (type.includes("=>") || /RefObject|ElementType/.test(type)) continue;
        const values = [...type.matchAll(/"([^"]+)"/g)].map((v) => v[1]);
        fields[name][key] = {
          type:
            values.length > 1
              ? "select"
              : type === "boolean"
                ? "boolean"
                : type === "number"
                  ? "number"
                  : type === "string" || type === "ReactNode"
                    ? "string"
                    : "json",
          ...(values.length > 1 ? { options: values } : {}),
        };
      }
    }
  }
  const tokenFiles = [
    "base.css",
    "theme-pwa.css",
    "theme-web.css",
    "theme.css",
  ];
  const tokens: LibraryMetadata["tokens"] = [];
  const raw: Record<string, string> = {};
  for (const name of tokenFiles) {
    const css = readFileSync(
      trusted(`packages/ui/src/tokens/${name}`),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    raw[name] = css;
    for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g))
      if (!tokens.some((t) => t.name === match[1]))
        tokens.push({
          name: match[1],
          value: match[2].trim(),
          source: name,
          category: /color|bg|accent|text-primary|status|avatar/.test(match[1])
            ? "color"
            : /font/.test(match[1])
              ? "fontFamily"
              : /radius|spacing|blur|text-/.test(match[1])
                ? "dimension"
                : "string",
        });
  }
  // Scope token declarations to the preview surface. No proprietary stylesheet is persisted.
  let css = `@import "tailwindcss";\n@source ${JSON.stringify(join(root, "packages/ui/src"))};\n`;
  css += raw["theme.css"];
  function declarations(text: string, selector: RegExp) {
    const match = text.match(selector);
    return match?.[1] ?? "";
  }
  const base = declarations(raw["base.css"], /:root\s*\{([^}]+)\}/);
  const pwaLight = declarations(
    raw["theme-pwa.css"],
    /\[data-theme=["']light["']\]\s*\{([^}]+)\}/,
  );
  const pwaDark = declarations(
    raw["theme-pwa.css"],
    /\[data-theme=["']dark["']\]\s*\{([^}]+)\}/,
  );
  const webLight = declarations(raw["theme-web.css"], /:root\s*\{([^}]+)\}/);
  const webDark = declarations(raw["theme-web.css"], /\.dark\s*\{([^}]+)\}/);
  const modes = {
    "pwa-light": base + pwaLight,
    "pwa-dark": base + pwaDark,
    "web-light": base + webLight,
    "web-dark": base + webLight + webDark,
  };
  for (const [mode, decl] of Object.entries(modes))
    css += `\n[data-studio-theme="${mode}"] { ${decl} color:var(--text-primary); background:var(--bg); }`;
  const metadata = createLocalMetadata({
    version: packageJson.version,
    exports,
    fields,
    tokens,
  });
  for (const token of metadata.tokens) {
    (token as typeof token & { themes?: Record<string, string> }).themes = {};
    for (const [mode, decl] of Object.entries(modes)) {
      const matches = [...decl.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)];
      const value = matches
        .filter((m) => m[1] === token.name)
        .at(-1)?.[2]
        ?.trim();
      if (value)
        (token as typeof token & { themes: Record<string, string> }).themes[
          mode
        ] = value;
    }
  }
  // Font assets remain in the operator's checkout and are served through Vite.
  for (const candidate of ["apps/pwa/src/index.css", "apps/web/src/index.css"])
    if (existsSync(join(root, candidate))) {
      const fontCss = readFileSync(trusted(candidate), "utf8");
      for (const match of fontCss.matchAll(/@font-face\s*\{[^}]+\}/g)) {
        css +=
          "\n" +
          match[0].replace(
            /url\(["']?([^)'"\s]+)["']?\)/g,
            (_, url: string) =>
              `url(${JSON.stringify(url.startsWith("/") ? `/@fs${join(root, candidate.startsWith("apps/pwa") ? "apps/pwa/public" : "apps/web/public", url)}` : `/@fs${resolve(dirname(join(root, candidate)), url)}`)})`,
          );
      }
    }
  return { root, metadata, modules, css };
}
export function getConfiguredLibraryMetadata(
  config: LibraryConfig = {},
): LibraryMetadata[] {
  const local = config.studioOnly ? undefined : inspectLocal(config);
  return [
    libraryMetadata(studioLibrary),
    ...(!config.studioOnly
      ? [libraryMetadata(builtinLibrary), libraryMetadata(exampleLibrary)]
      : []),
    ...(local ? [local.metadata] : []),
  ];
}
export function studioLibraryPlugin(config: LibraryConfig = {}): Plugin {
  const local = config.studioOnly ? undefined : inspectLocal(config);
  const id = "virtual:studio-libraries",
    cssId = "virtual:studio-library.css";
  return {
    name: "studio-trusted-library",
    config() {
      return {
        resolve: { dedupe: ["react", "react-dom"] },
        ssr: { noExternal: [/^@radix-ui\//] },
        server: {
          fs: { allow: [process.cwd(), ...(local ? [local.root] : [])] },
        },
      };
    },
    resolveId(request) {
      if (request === id || request === cssId) return "\0" + request;
    },
    load(request) {
      if (request === "\0" + cssId) return local?.css ?? "";
      if (request !== "\0" + id) return;
      const studioImport = `import {studioLibrary} from ${JSON.stringify(resolve(process.cwd(), "src/library/studio.tsx"))};\n`;
      if (config.studioOnly)
        return studioImport + "export const libraries=[studioLibrary];";
      let code =
        studioImport +
        `import {builtinLibrary} from ${JSON.stringify(resolve(process.cwd(), "src/library/builtin.tsx"))};\nimport {exampleLibrary} from ${JSON.stringify(resolve(process.cwd(), "src/library/example.tsx"))};\n`;
      if (local?.entry) {
        code += `import {${local.entry.exportName} as runtime} from ${JSON.stringify(local.entry.path)};\nimport {bindLibraryManifest} from ${JSON.stringify(resolve(process.cwd(), "src/library/sdk.ts"))};\nconst local=bindLibraryManifest(runtime,${JSON.stringify(local.metadata)});\nexport const libraries=[studioLibrary,builtinLibrary,exampleLibrary,local];`;
      } else if (local) {
        code += `import {createLocalLibrary} from ${JSON.stringify(resolve(process.cwd(), "src/library/localBrowser.tsx"))};\nimport ${JSON.stringify(cssId)};\n`;
        let n = 0;
        const bindings: string[] = [];
        for (const [name, module] of Object.entries(local.modules)) {
          if (local.metadata.components[name]?.support !== "rendered") continue;
          code += `import {${module.exportName === "default" ? "default" : module.exportName} as c${n}} from ${JSON.stringify(module.path)};\n`;
          bindings.push(`${JSON.stringify(name)}:c${n++}`);
        }
        code += `const local=createLocalLibrary({${bindings.join(",")}},${JSON.stringify(local.metadata)});\nexport const libraries=[studioLibrary,builtinLibrary,exampleLibrary,local];`;
      } else
        code +=
          "export const libraries=[studioLibrary,builtinLibrary,exampleLibrary];";
      return code;
    },
  };
}
