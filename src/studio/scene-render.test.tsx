import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Nodes } from "./Preview";
import { demoProject } from "../demo/project";
import { builtinLibrary } from "../library/builtin";
import { parseProject } from "../core/project";
it("renders scene geometry, passive vectors, local images and hidden layers", () => {
  const project = demoProject();
  const html = renderToStaticMarkup(<Nodes nodes={[
    { id: "frame", type: "SceneFrame", props: {}, slots: { content: [
      { id: "label", type: "SceneText", props: { text: "Заголовок" }, slots: {}, scene: { kind: "text", x: 10, y: 20, width: 100, height: 40, fontSize: 18 } },
    ] }, scene: { kind: "frame", x: 20, y: 30, width: 300, height: 200, fill: "#eee", clip: true } },
    { id: "image", type: "StudioImage", props: { src: "assets/" + "a".repeat(64) + ".png", objectFit: "cover" }, slots: {}, scene: { kind: "image", x: 0, y: 0, width: 60, height: 40 } },
    { id: "vector", type: "SceneVector", props: {}, slots: {}, scene: { kind: "vector", x: 0, y: 0, width: 50, height: 50, path: "M0 0L50 50", stroke: "#000", strokeWidth: 2 } },
    { id: "hidden", type: "Text", props: { text: "НЕ ПОКАЗЫВАТЬ" }, slots: {}, hidden: true },
  ]} library={builtinLibrary} project={project} selected={null} onSelect={() => {}} />);
  expect(html).toContain("Заголовок");
  expect(html).toContain("position:absolute");
  expect(html).toContain("left:20px");
  expect(html).toContain("object-fit:cover");
  expect(html).toContain('d="M0 0L50 50"');
  expect(html).not.toContain("НЕ ПОКАЗЫВАТЬ");
});
it("resolves token-bound image attributes just like exported screens", () => {
  const project = demoProject();
  const path = "assets/" + "a".repeat(64) + ".png";
  project.tokens = { photo: { type: "string", value: path }, caption: { type: "string", value: "Фото" }, fit: { type: "string", value: "cover" } };
  const html = renderToStaticMarkup(<Nodes nodes={[{ id: "photo", type: "StudioImage", props: { src: { $token: "photo" }, alt: { $token: "caption" }, objectFit: { $token: "fit" } }, slots: {} }]} library={builtinLibrary} project={project} selected={null} onSelect={() => {}} />);
  expect(html).toContain(`src="${path}"`);
  expect(html).toContain('alt="Фото"');
  expect(html).toContain("object-fit:cover");
  expect(html).not.toContain("[object Object]");
});
it("uses one collision-free materialized graph across sibling frames", () => {
  const project = parseProject({ ...demoProject(), designComponents: [
    { id: "first-definition", name: "First", version: 1, nodes: [{ id: "b::c", type: "SceneText", props: { text: "First child" }, slots: {}, scene: { kind: "text", x: 0, y: 0, width: 100, height: 40 } }] },
    { id: "second-definition", name: "Second", version: 1, nodes: [{ id: "c", type: "SceneText", props: { text: "Second child" }, slots: {}, scene: { kind: "text", x: 0, y: 0, width: 100, height: 40 } }] },
  ], pages: [{ screenId: "collision-page", name: "Collision", viewport: { width: 800 }, nodes: [
    { id: "frame-1", type: "SceneFrame", props: {}, slots: { content: [{ id: "a", type: "DesignInstance", props: {}, slots: {}, instance: { definitionId: "first-definition" } }] } },
    { id: "frame-2", type: "SceneFrame", props: {}, slots: { content: [{ id: "a::b", type: "DesignInstance", props: {}, slots: {}, instance: { definitionId: "second-definition" } }] } },
  ] }] });
  const html = renderToStaticMarkup(<Nodes nodes={project.pages[0].nodes} library={builtinLibrary} project={project} selected={null} onSelect={() => {}} />);
  const ids = [...html.matchAll(/data-node-id="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain("a::b::c");
  expect(ids).toContain("a::b::c~1");
  expect(html).toContain("First child");
  expect(html).toContain("Second child");
});
