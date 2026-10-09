import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Public synthetic adapter sources; no product checkout or node_modules is used. */
export async function writeDesktopLibraryFixture(root: string) {
  const source = join(root, "packages/ui/src");
  await mkdir(join(source, "tokens"), { recursive: true });
  await writeFile(join(root, "packages/ui/package.json"), '{"version":"1.0.0"}');
  await writeFile(
    join(source, "index.ts"),
    'export { Tabs, TabsList, TabsTrigger, TabsContent, SegmentedControl, Text } from "./controls";',
  );
  await writeFile(
    join(source, "controls.tsx"),
    `import { createContext, useContext } from "react";
const selection = createContext("");
export interface TextProps { children?: string; variant?: string; tone?: string; }
export function Text({ children }: any) { return <p>{children}</p>; }
export interface TabsProps {
  value?: string;
  size?: "sm" | "md";
  variant?: "underline" | "pill";
  activationMode?: "automatic" | "manual";
  className?: string;
  ignored?: string;
}
export function Tabs({ value, size, variant, activationMode, className, children }: any) {
  return <selection.Provider value={value}><div className={className} data-size={size} data-variant={variant} data-activation={activationMode}>{children}</div></selection.Provider>;
}
export function TabsList({ children }: any) { return <div role="tablist">{children}</div>; }
export function TabsTrigger({ value, className, children }: any) {
  return <button role="tab" className={className} aria-selected={useContext(selection) === value}>{children}</button>;
}
export function TabsContent({ value, children }: any) {
  return useContext(selection) === value ? <div role="tabpanel">{children}</div> : null;
}
export interface SegmentedControlProps { options?: unknown[]; value?: string; }
export function SegmentedControl({ options = [] }: any) {
  return <div>{options.map((item: any) => <span key={item.value}>{item.label} {item.code}</span>)}</div>;
}
`,
  );
  for (const name of ["base.css", "theme-pwa.css", "theme-web.css", "theme.css"])
    await writeFile(
      join(source, "tokens", name),
      name === "base.css" ? ":root { --bg: #fff; --text-primary: #123; }" : "",
    );
}

/** Child apps/helpers cannot discover development Node/npm or implicit library settings. */
export function desktopRuntimeEnv(settings: string, emptyPath: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !["PATH", "NODE_PATH", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"].includes(
        key.toUpperCase(),
      )
    )
      env[key] = value;
  }
  return {
    ...env,
    PATH: emptyPath,
    STUDIO_USER_DATA: settings,
    STUDIO_PROJECT: "",
    STUDIO_LIBRARY_ROOT: "",
    STUDIO_AUTO_APPLY: "",
  };
}

/** A portable document may reference a library before its operator trusts the source. */
export async function writeDesktopProjectFixture(root: string) {
  await writeFile(join(root, "project.json"), JSON.stringify({
    schemaVersion: 2, projectId: "installed-acceptance", name: "Installed acceptance",
    revision: 0, library: { id: "stroi-ui", version: "1.0.0" }, theme: "pwa-light", tokens: {},
    pages: [{ screenId: "acceptance-screen", name: "Synthetic screen", viewport: { width: 390, height: 600 },
      nodes: [{ id: "demo-title", type: "Text", props: { children: "Synthetic heading", variant: "body", tone: "primary" }, slots: {} }] }],
  }, null, 2));
}
