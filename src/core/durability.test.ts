import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncDirectory } from "./durability";
it("flushes directory metadata where supported without breaking Windows writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-sync-"));
  try {
    await expect(syncDirectory(root)).resolves.toBeUndefined();
    await expect(
      syncDirectory(join(root, "absent"), "win32"),
    ).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
