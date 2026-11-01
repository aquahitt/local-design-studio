import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaintFields, isRenderableFramePaintDraft } from "./PaintFields";
import type { SceneMetadata } from "../core/scene";

const scene: SceneMetadata = {
  kind: "frame",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  fills: [{ id: "paint", kind: "solid", color: { r: 255, g: 0, b: 0, a: 1 } }],
};
it("reuses the paint editor with stroke names and no shadow controls", () => {
  const props = {
    scene,
    disabled: false,
    onChange: () => {},
    onPendingChange: () => {},
    mode: "strokes" as const,
    renderPaintControls: () => <span>Stroke geometry</span>,
  };
  const html = renderToStaticMarkup(<PaintFields {...props} />);
  expect(html).toContain("Обводки");
  expect(html).toContain("Обводка 1");
  expect(html).toContain("Цвет обводки 1");
  expect(html).toContain("Добавить обводку");
  expect(html).toContain("Stroke geometry");
  expect(html).not.toContain("Добавить тень");
  expect(html).not.toContain("Заливка 1");
});

it("guards malformed advanced stroke JSON while keeping finite invalid bounds editable", () => {
  for (const strokes of [
    null,
    {},
    [null],
    [{ id: "bad", kind: "solid", width: 1, alignment: "inside", color: null }],
    [{ ...scene.fills![0], width: NaN, alignment: "inside" }],
  ])
    expect(isRenderableFramePaintDraft({ ...scene, strokes })).toBe(false);
  expect(
    isRenderableFramePaintDraft({
      ...scene,
      strokes: [{ ...scene.fills![0], width: -5, alignment: "inside" }],
    }),
  ).toBe(true);
});

it("keeps ordinary fill and shadow controls available by default", () => {
  const html = renderToStaticMarkup(
    <PaintFields
      scene={scene}
      disabled={false}
      onChange={() => {}}
      onPendingChange={() => {}}
    />,
  );
  expect(html).toContain("Заливка 1");
  expect(html).toContain("Добавить заливку");
  expect(html).toContain("Добавить тень");
});

it("preserves geometry by stable ID while paint kinds change and new rows get defaults", async () => {
  const { restoreStrokeGeometry, strokePaint } = await import("./StrokeFields");
  const old = { ...scene.fills![0], width: 14, alignment: "outside" as const };
  const stripped = strokePaint(old);
  expect(stripped).not.toHaveProperty("width");
  expect(stripped).not.toHaveProperty("alignment");
  const next = restoreStrokeGeometry(
    [
      { id: "new", kind: "solid", color: { r: 0, g: 0, b: 0, a: 1 } },
      {
        ...stripped,
        kind: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { offset: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
        ],
      },
    ],
    [old],
  );
  expect(next[0]).toMatchObject({ id: "new", width: 1, alignment: "inside" });
  expect(next[1]).toMatchObject({
    id: old.id,
    kind: "linear",
    width: 14,
    alignment: "outside",
  });
  expect(old).toMatchObject({ kind: "solid", width: 14 });
});

it("keeps unsupported legacy strokes explicit instead of silently replacing them", async () => {
  const { StrokeFields } = await import("./StrokeFields");
  const html = renderToStaticMarkup(
    <StrokeFields
      scene={{ ...scene, stroke: "red", strokeWidth: 5000 }}
      disabled={false}
      onChange={() => {}}
      onPendingChange={() => {}}
    />,
  );
  expect(html).toContain("Прежнюю обводку нельзя преобразовать точно");
  expect(html).toContain("Убрать прежнюю обводку");
  expect(html).toMatch(/disabled=""[^>]*>Преобразовать прежнюю обводку/);
});
