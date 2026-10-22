import type { Project, ProjectNode } from "./project";
import { CoreError } from "./tokens";

/** A transform of an instance wrapper also transforms its displayed definition
 * descendants. Their locks have the same authority as physical slot children.
 * Variants/overrides affect props only and cannot remove these locks. */
export function hasLockedSceneDescendant(
  project: Project,
  node: ProjectNode,
): boolean {
  const definitions = new Map(
    (project.designComponents ?? []).map((def) => [def.id, def]),
  );
  const cached = new Map<string, boolean>();
  const active = new Set<string>();
  function definition(id: string): boolean {
    const previous = cached.get(id);
    if (previous !== undefined) return previous;
    if (active.size > 64) throw new CoreError("MAX_DEPTH");
    if (active.has(id)) throw new CoreError("COMPONENT_CYCLE", id);
    const source = definitions.get(id);
    if (!source) throw new CoreError("MISSING_COMPONENT", id);
    active.add(id);
    const result = source.nodes.some(locked);
    active.delete(id);
    cached.set(id, result);
    return result;
  }
  function locked(current: ProjectNode): boolean {
    return (
      !!current.locked ||
      Object.values(current.slots).some((children) => children.some(locked)) ||
      (!!current.instance && definition(current.instance.definitionId))
    );
  }
  return locked(node);
}
