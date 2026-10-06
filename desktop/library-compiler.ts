import type { Plugin } from "esbuild";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import * as react from "react";
import * as reactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import { compile } from "tailwindcss";
import { inspectLocal, desktopLibraryEntry } from "../scripts/library/plugin";
import type { DesktopLibraryBundle } from "./libraries";
const runtime = { react, reactDOM, jsxRuntime, jsxDevRuntime };
const modules = {
  react: "react",
  "react-dom": "reactDOM",
  "react/jsx-runtime": "jsxRuntime",
  "react/jsx-dev-runtime": "jsxDevRuntime",
} as const;
const shim: Plugin = {
  name: "studio-react-runtime",
  setup(build) {
    build.onResolve(
      { filter: /^(react|react-dom)(\/jsx(-dev)?-runtime)?$/ },
      (args) => ({ path: args.path, namespace: "studio-runtime" }),
    );
    build.onLoad({ filter: /.*/, namespace: "studio-runtime" }, (args) => {
      const key = modules[args.path as keyof typeof modules];
      if (!key) throw new Error("UNSUPPORTED_REACT_ENTRY");
      const keys = Object.keys(runtime[key]).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      );
      return {
        contents:
          `const runtime=globalThis.__studioRuntime.${key};export default runtime;\n` +
          keys
            .map(
              (name) =>
                `export const ${name}=runtime[${JSON.stringify(name)}];`,
            )
            .join("\n"),
        loader: "js",
      };
    });
  },
};
async function candidates(root: string): Promise<string[]> {
  const output = new Set<string>();
  async function visit(path: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (
        item.isSymbolicLink() ||
        ["node_modules", ".git", "dist", ".studio"].includes(item.name)
      )
        continue;
      const next = join(path, item.name);
      if (item.isDirectory()) await visit(next);
      else if (/\.(tsx?|jsx?|html|css)$/.test(item.name)) {
        for (const match of (await readFile(next, "utf8")).matchAll(
          /[^\s"'`<>]+/g,
        ))
          output.add(match[0]);
      }
    }
  }
  await visit(root);
  return [...output];
}
/** Reads source/builds syntax only: external modules never execute in Node or the editor. */
export async function compileLibrary(
  root: string,
  output: string,
  id: string,
): Promise<DesktopLibraryBundle> {
  const local = inspectLocal({ externalRoot: root });
  if (!local) throw new Error("LIBRARY_NOT_FOUND");
  // Packaged copies of the adapter sources are included alongside the compiler.
  const sources = existsSync(join(__dirname, "library-sources"))
    ? join(__dirname, "library-sources")
    : resolve("src/library");
  const entry = desktopLibraryEntry(
    local,
    join(sources, "localBrowser.tsx"),
    join(sources, "sdk.ts"),
  );
  const assets: Plugin = {
    name: "studio-assets",
    setup(builder) {
      builder.onLoad(
        { filter: /\.(woff2?|ttf|otf|png|jpe?g|gif|svg|webp)$/ },
        async (args) => ({
          contents: await readFile(args.path),
          loader: "dataurl",
        }),
      );
    },
  };
  const { build } = await import("esbuild");
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "chrome130",
    jsx: "automatic",
    plugins: [shim, assets],
    outfile: join(output, "library.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  for (const file of result.outputFiles ?? [])
    await writeFile(file.path, file.contents);
  const cssOutput =
    result.outputFiles?.find((file) => file.path.endsWith(".css"))?.text ?? "";
  let css = local.css.replace(/^@source[^;]+;/gm, "") + "\n" + cssOutput;
  const compiled = await compile(css, {
    base: root,
    loadStylesheet: async (id, base) => {
      const path =
        id === "tailwindcss"
          ? existsSync(join(__dirname, "vendor/tailwindcss/index.css"))
            ? join(__dirname, "vendor/tailwindcss/index.css")
            : require.resolve("tailwindcss/index.css")
          : resolve(base, id);
      return {
        path,
        base: dirname(path),
        content: await readFile(path, "utf8"),
      };
    },
  });
  css = compiled.build(await candidates(root));
  // Font declarations discovered by the adapter refer to the operator checkout.
  css = await inlineFonts(css, root);
  await writeFile(join(output, "library.css"), css);
  return {
    id,
    root: output,
    files: ["library.js", "library.css"],
    metadata: local.metadata,
  };
}
async function inlineFonts(css: string, root: string) {
  const matches = [...css.matchAll(/url\(["']?(\/\@fs[^)'"\s]+)["']?\)/g)];
  for (const match of matches) {
    const path = await realpath(match[1].slice(4));
    const rel = relative(root, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("LIBRARY_ASSET_ESCAPED_ROOT");
    const data = await readFile(path);
    const mime = extname(path) === ".woff2" ? "font/woff2" : "font/woff";
    css = css.replace(
      match[0],
      `url("data:${mime};base64,${data.toString("base64")}")`,
    );
  }
  return css;
}
