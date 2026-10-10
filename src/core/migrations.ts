import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CoreError } from "./tokens";
import { syncDirectory } from "./durability";

async function noSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new CoreError("SYMLINK_FORBIDDEN", path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
/** Called only by the locked owner, after migration validation and before the first rewrite. */
export async function backupLegacyProject(
  root: string,
  source: Uint8Array,
): Promise<string> {
  const studio = join(root, ".studio"),
    directory = join(studio, "backups");
  await noSymlink(root);
  await noSymlink(studio);
  await noSymlink(directory);
  await mkdir(directory, { mode: 0o700 }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
  await noSymlink(directory);
  const digest = createHash("sha256").update(source).digest("hex");
  const target = join(directory, `project-v1-${digest}.json`);
  await noSymlink(target);
  let created = false;
  try {
    const file = await open(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    try {
      await file.writeFile(source);
      await file.sync();
    } finally {
      await file.close();
    }
    await syncDirectory(directory);
    await syncDirectory(studio);
    return target;
  } catch (error) {
    if (created) {
      await unlink(target).catch(() => {});
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!Buffer.from(source).equals(await file.readFile()))
        throw new CoreError("MIGRATION_BACKUP_CONFLICT", target);
    } finally {
      await file.close();
    }
    return target;
  }
}
