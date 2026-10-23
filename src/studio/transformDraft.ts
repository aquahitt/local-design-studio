export function parseTransformNumber(raw: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))
    return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
export function linkedTransformValues(
  field: "width" | "height",
  raw: string,
  size: { width: number; height: number },
): Partial<Record<"width" | "height", string>> {
  const value = parseTransformNumber(raw);
  if (value === undefined || value <= 0 || size.width <= 0 || size.height <= 0)
    return { [field]: raw };
  return field === "width"
    ? { width: raw, height: String((value * size.height) / size.width) }
    : { height: raw, width: String((value * size.width) / size.height) };
}
export type TransformSnapshotKey = {
  projectId: string;
  revision: number;
  pageId: string;
  selectedIds: string[];
};
export function transformSelectionMatches(
  a: TransformSnapshotKey,
  b: TransformSnapshotKey,
): boolean {
  const right = [...b.selectedIds].sort();
  return (
    a.projectId === b.projectId &&
    a.pageId === b.pageId &&
    a.selectedIds.length === right.length &&
    [...a.selectedIds].sort().every((id, index) => id === right[index])
  );
}
export function transformSnapshotMatches(
  a: TransformSnapshotKey,
  b: TransformSnapshotKey,
): boolean {
  return a.revision === b.revision && transformSelectionMatches(a, b);
}
