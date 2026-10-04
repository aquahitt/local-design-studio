import { open } from "node:fs/promises";
/** Windows cannot open directories for fsync; file contents are still flushed before rename. */
export async function syncDirectory(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") return;
  const dir = await open(path, "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
