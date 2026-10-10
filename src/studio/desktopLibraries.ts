import type { ComponentLibrary, LibraryMetadata } from "../library/sdk";
import type { DesktopLibrary } from "../desktop/types";
/** Editor registers declarative metadata only; executable renderers stay in the preview. */
export function desktopMetadataLibrary(
  metadata: LibraryMetadata,
): ComponentLibrary {
  return {
    ...metadata,
    components: Object.fromEntries(
      Object.entries(metadata.components).map(([name, descriptor]) => [
        name,
        { ...descriptor, render: () => null },
      ]),
    ),
  };
}
/** Invoke only inside studio://preview; the protocol refuses these files to the editor. */
export async function loadDesktopLibrary(
  library: DesktopLibrary,
): Promise<ComponentLibrary> {
  if (location.origin !== "studio://preview")
    throw new Error("PREVIEW_LIBRARY_ONLY");
  for (const path of [library.bundleUrl, library.cssUrl]) {
    const url = new URL(path);
    if (
      url.protocol !== "studio:" ||
      url.hostname !== "preview" ||
      !/^\/library\/[a-f0-9-]+\/library\.(js|css)$/.test(url.pathname)
    )
      throw new Error("INVALID_LIBRARY_BUNDLE_URL");
  }
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = library.cssUrl;
  await new Promise<void>((resolve, reject) => {
    stylesheet.onload = () => resolve();
    stylesheet.onerror = () => reject(new Error("LIBRARY_STYLESHEET_FAILED"));
    document.head.append(stylesheet);
  });
  const runtime = await import(/* @vite-ignore */ library.bundleUrl);
  return runtime.default as ComponentLibrary;
}
