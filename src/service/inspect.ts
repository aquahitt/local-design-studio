import type { Project } from "../core/project";
import {
  inspectModel,
  type HandoffOptions,
  type HandoffDiagnostic,
} from "../core/handoff";
import type { LibraryMetadata } from "../library/sdk";
import type { RenderOptions, RenderResult } from "./render";

export async function inspectDocument(
  project: Project,
  options: HandoffOptions & { nodeId: string },
  libraries: LibraryMetadata[],
  render?: (project: Project, options: RenderOptions) => Promise<RenderResult>,
) {
  const model = inspectModel(project, options, libraries);
  const diagnostics: HandoffDiagnostic[] = [];
  if (!render) {
    diagnostics.push({
      code: "COMPUTED_STYLES_UNAVAILABLE",
      nodeId: options.nodeId,
      message: "Owner does not provide a browser renderer",
    });
    return { ...model, bounds: null, computedStyles: null, diagnostics };
  }
  const capture = await render(project, {
    pageId: options.pageId,
    revision: options.revision,
  });
  const bounds =
    capture.bounds.find((bounds) => bounds.id === options.nodeId) ?? null;
  const computedStyles =
    capture.computedStyles?.find((styles) => styles.id === options.nodeId) ??
    null;
  if (!bounds)
    diagnostics.push({
      code: "NODE_NOT_VISIBLE",
      nodeId: options.nodeId,
      message: "Layer is hidden or absent in the actual DOM",
    });
  if (!computedStyles)
    diagnostics.push({
      code: "COMPUTED_STYLES_UNAVAILABLE",
      nodeId: options.nodeId,
      message: "Renderer did not return computed styles for this layer",
    });
  return {
    ...model,
    viewport: capture.viewport,
    bounds,
    computedStyles,
    warnings: capture.warnings,
    diagnostics,
  };
}
