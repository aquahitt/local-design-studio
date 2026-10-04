import { resolve } from "node:path";
import { createStudioServer } from "./server";
import { getConfiguredLibraryMetadata } from "../../scripts/library/plugin";
const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
if (!value("--project"))
  throw new Error(
    "Usage: npm run service -- --project <directory> [--port 5190]",
  );
const studio = await createStudioServer({
  root: resolve(value("--project")!),
  libraryMetadata: getConfiguredLibraryMetadata({
    externalRoot: process.env.STUDIO_LIBRARY_ROOT,
  }),
  port: Number(value("--port") ?? 5190),
  autoApply: process.env.STUDIO_AUTO_APPLY === "1",
});
process.stdout.write(`Studio service: ${studio.url}\n`);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await studio.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
