import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createManifest, verifyRelease } from "../release/integrity.mjs";
const root = process.argv[2] ?? "out/make";
await writeFile(
  join(root, `SHA256SUMS-${process.platform}-${process.arch}.txt`),
  await createManifest(root),
);
await verifyRelease(root);
