import { createRoot, type Root } from "react-dom/client";
import { Nodes } from "../../src/studio/Preview";
import { I18nProvider } from "../../src/studio/i18n";
import { studioLibrary } from "../../src/library/studio";
import { demoProject } from "../../src/demo/project";
import { createImageResourceLoader } from "../../src/library/image-resource-runtime";
import { collectImagePaintReferences } from "../../src/core/image-paint";
import type { ProjectNode } from "../../src/core/project";
let root: Root | undefined;
export async function mount(nodes: ProjectNode[]) {
  document.body.style.cssText = "margin:0;background:white";
  if (!root) {
    const host = document.createElement("div");
    host.style.cssText = "position:relative;width:600px;height:500px";
    document.body.append(host);
    root = createRoot(host);
  }
  root.render(
    <I18nProvider locale="en">
      <Nodes
        nodes={nodes}
        project={demoProject()}
        library={studioLibrary}
        selected={null}
        onSelect={() => {}}
      />
    </I18nProvider>,
  );
  const loader = createImageResourceLoader(document);
  const result = await loader.load({
    projectId: "paint-pixels",
    revision: 0,
    assets: collectImagePaintReferences(nodes, "rendered").map(
      (ref) => ref.asset,
    ),
  });
  loader.dispose();
  if (result.warnings.length) throw new Error(JSON.stringify(result.warnings));
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
