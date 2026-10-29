import type { PageGuide } from "../core/guides";
import { resolveSceneNodes } from "../core/design-components";
import type { ProjectFont } from "../core/fonts";
import { usedTextFontIds } from "../core/text-style";
import { applyBatch, type Batch } from "../core/operations";
import type { Project } from "../core/project";
import { stableStringify } from "../core/project";
import type { LibraryMetadata } from "../library/sdk";
import { validateComponentProps } from "../service/schema";

export type PreviewFontChange = {
  fontId: string;
  before?: ProjectFont;
  after?: ProjectFont;
};
/** Include every descriptor used by byte verification, so mismatches receive a visual warning. Only the display name is metadata-only. */
function fontPaintIdentity(font: ProjectFont | undefined) {
  return font
    ? stableStringify({
        family: font.family,
        assetHash: font.assetHash,
        format: font.format,
        weight: font.weight,
        style: font.style,
      })
    : "null";
}
export function buildProposalPreview(
  project: Project,
  batch: Batch,
  metadata?: LibraryMetadata[],
): {
  after?: Project;
  pageIds: string[];
  fontChanges: PreviewFontChange[];
  error?: string;
} {
  if (batch.baseRevision !== project.revision)
    return {
      pageIds: [],
      fontChanges: [],
      error: "Устаревшая ревизия. Агенту нужно обновить предложение.",
    };
  try {
    const after = applyBatch(project, batch);
    validateComponentProps(after, metadata);
    const oldFonts = new Map(
      (project.fonts ?? []).map((font) => [font.id, font]),
    );
    const newFonts = new Map(
      (after.fonts ?? []).map((font) => [font.id, font]),
    );
    const fontChanges: PreviewFontChange[] = [
      ...new Set([...oldFonts.keys(), ...newFonts.keys()]),
    ].flatMap((fontId) => {
      const before = oldFonts.get(fontId),
        next = newFonts.get(fontId);
      return stableStringify(before ?? null) === stableStringify(next ?? null)
        ? []
        : [
            {
              fontId,
              ...(before ? { before } : {}),
              ...(next ? { after: next } : {}),
            },
          ];
    });
    const changedFaces = new Set(
      fontChanges
        .filter(
          (change) =>
            fontPaintIdentity(change.before) !==
            fontPaintIdentity(change.after),
        )
        .map((change) => change.fontId),
    );
    function hasChangedFace(doc: Project, id: string) {
      if (!changedFaces.size) return false;
      const page = doc.pages.find((page) => page.screenId === id);
      return (
        !!page &&
        usedTextFontIds(resolveSceneNodes(doc, page.nodes)).some((fontId) =>
          changedFaces.has(fontId),
        )
      );
    }
    const global = batch.operations.some(
      (op) => op.type === "setTokens" || op.type === "setTheme",
    );
    const ids = [
      ...new Set([...project.pages, ...after.pages].map((p) => p.screenId)),
    ];
    const pageIds = ids.filter(
      (id) =>
        global ||
        hasChangedFace(project, id) ||
        hasChangedFace(after, id) ||
        stableStringify(
          project.pages.find((p) => p.screenId === id) ?? null,
        ) !==
          stableStringify(after.pages.find((p) => p.screenId === id) ?? null),
    );
    return { after, pageIds, fontChanges };
  } catch (e) {
    return {
      pageIds: [],
      fontChanges: [],
      error: "Не удалось построить превью: " + (e as Error).message,
    };
  }
}

/** Detached editor metadata; never mutates either proposal document. */
export function guideProposalChanges(
  before: readonly PageGuide[] = [],
  after: readonly PageGuide[] = [],
) {
  const old = new Map(before.map((guide) => [guide.id, guide]));
  const next = new Map(after.map((guide) => [guide.id, guide]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
    const a = old.get(id),
      b = next.get(id);
    return stableStringify(a ?? null) === stableStringify(b ?? null)
      ? []
      : [
          {
            id,
            ...(a ? { before: { ...a } } : {}),
            ...(b ? { after: { ...b } } : {}),
          },
        ];
  });
}
