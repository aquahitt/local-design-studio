import { applyBatch, type Batch } from "../core/operations";
import type { Project } from "../core/project";
import { stableStringify } from "../core/project";
import type { LibraryMetadata } from "../library/sdk";
import { validateComponentProps } from "../service/schema";

export function buildProposalPreview(
  project: Project,
  batch: Batch,
  metadata?: LibraryMetadata[],
): {
  after?: Project;
  pageIds: string[];
  error?: string;
} {
  if (batch.baseRevision !== project.revision)
    return {
      pageIds: [],
      error: "Устаревшая ревизия. Агенту нужно обновить предложение.",
    };
  try {
    const after = applyBatch(project, batch);
    validateComponentProps(after, metadata);
    const global = batch.operations.some(
      (op) => op.type === "setTokens" || op.type === "setTheme",
    );
    const ids = [
      ...new Set([...project.pages, ...after.pages].map((p) => p.screenId)),
    ];
    const pageIds = ids.filter(
      (id) =>
        global ||
        stableStringify(
          project.pages.find((p) => p.screenId === id) ?? null,
        ) !==
          stableStringify(after.pages.find((p) => p.screenId === id) ?? null),
    );
    return { after, pageIds };
  } catch (e) {
    return {
      pageIds: [],
      error: "Не удалось построить превью: " + (e as Error).message,
    };
  }
}
