import { CoreError } from "./tokens";
export type PageGuide = {
  id: string;
  axis: "x" | "y";
  position: number;
  locked?: boolean;
};
export const GUIDE_LIMITS = Object.freeze({
  count: 1000,
  idLength: 200,
  position: 1_000_000,
});
/** Page-local metadata only: guides never become scene nodes or exported pixels. */
export function parseGuides(value: unknown, path = "guides"): PageGuide[] {
  if (!Array.isArray(value)) throw new CoreError("INVALID_GUIDE", path, path);
  if (value.length > GUIDE_LIMITS.count)
    throw new CoreError("GUIDE_LIMIT", path, path);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const location = `${path}[${index}]`;
    const fail = () => {
      throw new CoreError("INVALID_GUIDE", location, location);
    };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const guide = raw as Record<string, unknown>;
    if (
      Object.keys(guide).some(
        (key) => !["id", "axis", "position", "locked"].includes(key),
      ) ||
      typeof guide.id !== "string" ||
      !guide.id.trim() ||
      guide.id.length > GUIDE_LIMITS.idLength ||
      (guide.axis !== "x" && guide.axis !== "y") ||
      typeof guide.position !== "number" ||
      !Number.isFinite(guide.position) ||
      Math.abs(guide.position) > GUIDE_LIMITS.position ||
      (guide.locked !== undefined && typeof guide.locked !== "boolean")
    )
      fail();
    if (ids.has(guide.id as string))
      throw new CoreError("DUPLICATE_GUIDE", location, location);
    ids.add(guide.id as string);
    return {
      id: guide.id as string,
      axis: guide.axis as PageGuide["axis"],
      position: guide.position as number,
      ...(guide.locked !== undefined
        ? { locked: guide.locked as boolean }
        : {}),
    };
  });
}
