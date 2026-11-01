import { CoreError, type Project, type ProjectNode } from "../core/project";
import { definitionNodes, resolveSceneNodes } from "../core/design-components";

/** Resource readiness may be scoped without changing the rendered DOM or its layout.
 * Keep ancestors for font inheritance, but never load unrelated sibling resources.
 */
export function previewResourceScope(
  project: Project,
  nodes: ProjectNode[],
  resourceNodeId?: string,
): { imageNodes: ProjectNode[]; fontNodes: ProjectNode[] } {
  if (
    resourceNodeId !== undefined &&
    (typeof resourceNodeId !== "string" ||
      !definitionNodes(nodes).has(resourceNodeId))
  )
    throw new CoreError("NODE_NOT_FOUND");
  const resolved = resolveSceneNodes(project, nodes);
  if (resourceNodeId === undefined)
    return { imageNodes: resolved, fontNodes: resolved };
  const selected = definitionNodes(resolved).get(resourceNodeId);
  if (!selected) throw new CoreError("NODE_NOT_FOUND");
  function prune(rows: ProjectNode[]): ProjectNode[] {
    return rows.flatMap((node) => {
      if (node.id === resourceNodeId) return [node];
      const slots = Object.fromEntries(
        Object.entries(node.slots).map(([name, children]) => [
          name,
          prune(children),
        ]),
      );
      return Object.values(slots).some((children) => children.length)
        ? [{ ...node, slots }]
        : [];
    });
  }
  return { imageNodes: [selected], fontNodes: prune(resolved) };
}
