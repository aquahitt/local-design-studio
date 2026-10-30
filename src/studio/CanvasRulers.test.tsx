import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasRulers } from "./CanvasRulers";
const props = {
  view: { zoom: 1, panX: 140, panY: 200 },
  size: { width: 1000, height: 700 },
  onGuideCreateStart: () => {},
  onGuideCreate: () => {},
  onManageGuides: () => {},
};
it("exposes only three keyboard controls while keeping tick labels decorative", () => {
  const html = renderToStaticMarkup(<CanvasRulers {...props} />);
  expect(html.match(/<button/g)).toHaveLength(3);
  expect(html).toContain('aria-label="Горизонтальная линейка"');
  expect(html).toContain('aria-label="Вертикальная линейка"');
  expect(html).toContain('aria-label="Управление направляющими"');
  expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(3);
  expect(html).not.toContain("tabindex");
  expect(html).not.toContain("data-node-id");
});
it("renders fixed-size CSS-space ruler decoration with world-origin values", () => {
  const html = renderToStaticMarkup(<CanvasRulers {...props} />);
  expect(html).toContain('viewBox="0 0 1000 24"');
  expect(html).toContain('viewBox="0 0 24 700"');
  expect(html).toContain('vector-effect="non-scaling-stroke"');
  expect(html).toContain(">0</text>");
  expect(html).toContain(">-100</text>");
});
it("disables creation and management together without removing semantic controls", () => {
  const html = renderToStaticMarkup(<CanvasRulers {...props} disabled />);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
});
it("does not create negative-sized SVGs before surface measurement", () => {
  expect(
    renderToStaticMarkup(
      <CanvasRulers {...props} size={{ width: 0, height: 0 }} />,
    ),
  ).toBe("");
});
