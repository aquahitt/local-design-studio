import type { Project, ProjectNode } from "../core/project";
import { resolveSceneNodes } from "../core/design-components";
import {
  fontAssetPath,
  projectFontFamily,
  type ProjectFont,
} from "../core/fonts";
import { usedTextFontIds } from "../core/text-style";
export type ProjectFontWarning = {
  code: "PROJECT_FONT_UNAVAILABLE";
  fontId: string;
  message: string;
};
// Metadata can change while content-addressed bytes stay the same. Both the
// in-document cache and HTTP request identity must invalidate together.
const faceIdentity = (font: ProjectFont) =>
  JSON.stringify([
    font.assetHash,
    font.format,
    font.family,
    font.weight,
    font.style,
  ]);
export const projectFontSource = (font: ProjectFont) =>
  `/${fontAssetPath(font)}?face=${encodeURIComponent(faceIdentity(font))}`;
/** One loader belongs to one preview document. No process-global face cache or local() lookup. */
export function createProjectFontLoader(
  owner: Document,
  options: {
    timeoutMs?: number;
    createFace?: (
      family: string,
      source: string,
      descriptors: FontFaceDescriptors,
    ) => FontFace;
  } = {},
) {
  const createFace =
    options.createFace ??
    ((family, source, descriptors) =>
      new FontFace(family, source, descriptors));
  const entries = new Map<
    string,
    { face: FontFace; promise: Promise<FontFace>; added: boolean }
  >();
  let generation = 0,
    projectId: string | undefined;
  function clear() {
    for (const entry of entries.values())
      if (entry.added) owner.fonts.delete(entry.face);
    entries.clear();
  }
  return {
    async load(
      project: Project,
      nodes: ProjectNode[],
    ): Promise<{ warnings: ProjectFontWarning[] }> {
      const ticket = ++generation;
      if (projectId !== project.projectId) {
        clear();
        projectId = project.projectId;
      }
      const ids = usedTextFontIds(resolveSceneNodes(project, nodes));
      const descriptors = ids.map((id) => ({
        id,
        font: project.fonts?.find((font) => font.id === id),
      }));
      const wanted = new Set(
        descriptors.flatMap(({ font }) => (font ? [faceIdentity(font)] : [])),
      );
      for (const [key, entry] of entries)
        if (!wanted.has(key)) {
          if (entry.added) owner.fonts.delete(entry.face);
          entries.delete(key);
        }
      const warnings: ProjectFontWarning[] = [];
      await Promise.all(
        descriptors.map(async ({ id, font }) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const unavailable = () =>
            warnings.push({
              code: "PROJECT_FONT_UNAVAILABLE",
              fontId: id,
              message: `Project font ${id} could not be loaded; displayed text may use fallback glyphs`,
            });
          if (!font) {
            unavailable();
            return;
          }
          const key = faceIdentity(font);
          let entry = entries.get(key);
          try {
            if (!entry) {
              const format =
                font.format === "ttf"
                  ? "truetype"
                  : font.format === "otf"
                    ? "opentype"
                    : font.format;
              const face = createFace(
                projectFontFamily(font),
                `url("${projectFontSource(font)}") format("${format}")`,
                {
                  weight: String(font.weight),
                  style: font.style,
                  display: "block",
                },
              );
              entry = { face, promise: face.load(), added: false };
              entries.set(key, entry);
            }
            await Promise.race([
              entry.promise,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("FONT_TIMEOUT")),
                  options.timeoutMs ?? 5000,
                );
              }),
            ]);
            if (
              generation === ticket &&
              entries.get(key) === entry &&
              !entry.added
            ) {
              owner.fonts.add(entry.face);
              entry.added = true;
            }
          } catch {
            if (generation === ticket) {
              if (entries.get(key) === entry) {
                if (entry?.added) owner.fonts.delete(entry.face);
                entries.delete(key);
              }
              unavailable();
            }
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      return { warnings: generation === ticket ? warnings : [] };
    },
    cancel() {
      generation++;
    },
    dispose() {
      generation++;
      clear();
      projectId = undefined;
    },
  };
}
