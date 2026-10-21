import type { Project } from "../core/project";
import { createReactHandoff, type HandoffOptions } from "../core/handoff";
import type { LibraryMetadata } from "../library/sdk";

/** Return a reviewable file map; exported source never contains operator-library code or filesystem paths. */
export async function exportReactHandoff(
  project: Project,
  options: HandoffOptions,
  libraries: LibraryMetadata[],
  readAsset?: (name: string) => Promise<Uint8Array>,
) {
  const handoff = createReactHandoff(project, options, libraries);
  const assets: { path: string; mediaType: string; data: string }[] = [];
  for (const path of handoff.assetPaths) {
    try {
      if (!readAsset) throw new Error("ASSET_UNAVAILABLE");
      const bytes = await readAsset(path.slice(7));
      assets.push({
        path,
        mediaType: path.endsWith(".svg")
          ? "image/svg+xml"
          : path.endsWith(".png")
            ? "image/png"
            : path.endsWith(".ttf")
              ? "font/ttf"
              : path.endsWith(".otf")
                ? "font/otf"
                : path.endsWith(".woff2")
                  ? "font/woff2"
                  : "font/woff",
        data: Buffer.from(bytes).toString("base64"),
      });
    } catch {
      handoff.diagnostics.push({
        code: /\.(?:ttf|otf|woff2?)$/.test(path)
          ? "MISSING_FONT"
          : "MISSING_ASSET",
        message: `Asset ${path} could not be read from this project`,
      });
    }
  }
  handoff.supported = handoff.diagnostics.length === 0;
  handoff.files["manifest.json"] =
    JSON.stringify(handoff.manifest, null, 2) + "\n";
  if (!handoff.supported)
    handoff.files["README.md"] +=
      "\nExport diagnostics:\n" +
      handoff.diagnostics
        .map((diagnostic) => `- ${diagnostic.code}: ${diagnostic.message}`)
        .join("\n") +
      "\n";
  return { ...handoff, assets };
}
