import { readFileSync } from "node:fs";
import { transformsEnglish } from "./locales/en-transforms";
import { I18nProvider } from "./i18n";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseProject } from "../core/project";
import { sceneProject } from "../core/scene-fixtures";
import { TransformControls } from "./TransformControls";
function fixture() {
  const project = parseProject(sceneProject());
  project.pages[0].nodes = [
    {
      id: "a",
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: { kind: "frame", x: 0, y: 0, width: 200, height: 100 },
    },
    {
      id: "b",
      type: "SceneFrame",
      props: {},
      slots: {},
      scene: { kind: "frame", x: 300, y: 0, width: 100, height: 100 },
    },
  ];
  return project;
}
it("shows layout dimensions for one root and world dimensions for multiple roots", () => {
  const project = fixture();
  const render = (selectedIds: string[]) =>
    renderToStaticMarkup(
      <TransformControls
        project={project}
        pageId={project.pages[0].screenId}
        selectedIds={selectedIds}
        onApply={async () => {
          throw new Error("SSR must never write");
        }}
      />,
    );
  expect(render(["a"])).toContain("Ширина контейнера, px");
  expect(render(["a", "b"])).toContain("Ширина выделения, px");
  expect(render(["a", "b"])).toContain("400 × 100 px");
  expect(render([])).toBe("");
});
it("does not expose enabled controls when the selection is deleted or locked", () => {
  const project = fixture();
  project.pages[0].nodes[0].locked = true;
  for (const ids of [["a"], ["deleted"]]) {
    const markup = renderToStaticMarkup(
      <TransformControls
        project={project}
        pageId={project.pages[0].screenId}
        selectedIds={ids}
        onApply={async () => {}}
      />,
    );
    expect(markup).toContain('<fieldset disabled=""');
    expect(markup).toContain('role="alert"');
  }
});

it("translates the controls and every Russian UI literal instead of falling back to Russian", () => {
  const project = fixture();
  const markup = renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <TransformControls
        project={project}
        pageId={project.pages[0].screenId}
        selectedIds={["a"]}
        onApply={async () => {}}
      />
    </I18nProvider>,
  );
  expect(markup).toContain("Transforms");
  expect(markup).not.toMatch(/[А-Яа-яЁё]/);
  const source = readFileSync(
    new URL("./TransformControls.tsx", import.meta.url),
    "utf8",
  );
  const missing = [...source.matchAll(/"([^"\n]*[А-Яа-яЁё][^"\n]*)"/g)]
    .map((match) => match[1])
    .filter((copy) => !transformsEnglish[copy]);
  expect(missing).toEqual([]);
});
