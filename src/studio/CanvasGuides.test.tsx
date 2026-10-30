import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CanvasGuideOverlay,
  CanvasGuidePanel,
  guideCreateIntent,
  guideDraftInput,
  guideDraftStatus,
  projectGuideLines,
} from "./CanvasGuides";
import type { PageGuide } from "../core/guides";

const scope = { projectId: "project", pageId: "page", revision: 7 };
const guides: PageGuide[] = [
  { id: "x", axis: "x", position: -20 },
  { id: "y", axis: "y", position: 30, locked: true },
];
it("projects world guides through zoom/pan and clips only offscreen lines", () => {
  expect(
    projectGuideLines(
      { zoom: 2, panX: 50, panY: -5 },
      { width: 200, height: 100 },
      guides,
    ),
  ).toEqual([
    { guide: guides[0], x1: 10, y1: 0, x2: 10, y2: 100 },
    { guide: guides[1], x1: 0, y1: 55, x2: 200, y2: 55 },
  ]);
  expect(
    projectGuideLines(
      { zoom: 0.5, panX: 0, panY: 0 },
      { width: 200, height: 100 },
      guides,
    ),
  ).toHaveLength(1);
  for (const view of [
    { zoom: 0, panX: 0, panY: 0 },
    { zoom: 1, panX: Infinity, panY: 0 },
  ])
    expect(
      projectGuideLines(view, { width: 200, height: 100 }, guides),
    ).toEqual([]);
});
it("retains exact incomplete numeric input and its first revision without rebasing", () => {
  const draft = guideDraftInput(undefined, scope, "-", guides[0]);
  const changed = guideDraftInput(
    draft,
    { ...scope, revision: 8 },
    "1e",
    guides[0],
  );
  expect(changed.raw).toBe("1e");
  expect(changed.scope.revision).toBe(7);
  expect(guideDraftStatus(changed, scope)).toMatchObject({
    valid: false,
    stale: false,
  });
  expect(guideDraftStatus(changed, { ...scope, revision: 8 })).toMatchObject({
    valid: false,
    stale: true,
  });
  expect(guideDraftInput(changed, scope, "100", guides[1])).toBe(changed);
});
it("accepts finite bounded decimals but rejects a locked, stale or unavailable commit", () => {
  for (const raw of ["", " ", "-", "1e", "Infinity", "0x10", "1000001"])
    expect(
      guideDraftStatus(guideDraftInput(undefined, scope, raw), scope).valid,
    ).toBe(false);
  expect(
    guideDraftStatus(guideDraftInput(undefined, scope, "-1.25e2"), scope),
  ).toMatchObject({ valid: true, position: -125 });
  expect(
    guideDraftStatus(guideDraftInput(undefined, scope, "1", guides[1]), scope)
      .valid,
  ).toBe(false);
  expect(
    guideDraftStatus(guideDraftInput(undefined, scope, "1"), {
      ...scope,
      projectId: "other",
    }).valid,
  ).toBe(false);
  expect(
    guideDraftStatus(guideDraftInput(undefined, scope, "1"), scope, false)
      .valid,
  ).toBe(false);
});
it("consumes an explicit create intent once and never overwrites or later resurrects a dirty draft", () => {
  const first = { axis: "y" as const, position: 42 };
  const opened = guideCreateIntent(
    { open: false },
    {
      open: true,
      intent: first,
      scope,
      available: true,
      disabled: false,
      busy: false,
    },
  );
  expect(opened.draft).toMatchObject({
    kind: "create",
    axis: "y",
    raw: "42",
    scope,
  });
  const newer = { axis: "x" as const, position: 90 };
  const ignored = guideCreateIntent(opened.cursor, {
    open: true,
    intent: newer,
    scope: { ...scope, revision: 8 },
    available: true,
    disabled: false,
    busy: false,
    draft: opened.draft,
  });
  expect(ignored.draft).toBeUndefined();
  expect(
    guideCreateIntent(ignored.cursor, {
      open: true,
      intent: newer,
      scope,
      available: true,
      disabled: false,
      busy: false,
    }).draft,
  ).toBeUndefined();
  expect(
    guideCreateIntent(
      { open: false },
      {
        open: true,
        intent: first,
        scope,
        available: false,
        disabled: false,
        busy: false,
      },
    ).draft,
  ).toBeUndefined();
});
it("exposes editor-only non-tabbed handles and canonical guide positions remain unchanged during transient drag", () => {
  const before = JSON.stringify(guides);
  const markup = renderToStaticMarkup(
    <CanvasGuideOverlay
      view={{ zoom: 1, panX: 0, panY: 0 }}
      size={{ width: 200, height: 100 }}
      guides={guides}
      transientPositions={new Map([["x", 40]])}
      onGuidePointerDown={() => {}}
    />,
  );
  expect(markup).toContain('data-guide-id="x"');
  expect(markup).toContain("left:28px");
  expect(markup.match(/tabindex="-1"/g)).toHaveLength(2);
  expect(markup).not.toContain("data-node-id");
  expect(markup).not.toContain("NaN");
  expect(JSON.stringify(guides)).toBe(before);
});
it("renders a labelled dialog with numeric and lock alternatives while unavailable input stays readable", () => {
  const markup = renderToStaticMarkup(
    <CanvasGuidePanel
      open
      guides={guides}
      contextScope={scope}
      available={false}
      onClose={() => {}}
      onCreate={async () => {}}
      onMove={async () => {}}
      onRemove={async () => {}}
      onLock={async () => {}}
    />,
  );
  expect(markup).toContain('aria-label="Направляющие страницы"');
  expect(markup).toContain("Страница недоступна. Ввод сохранён.");
  expect(markup).toContain('inputMode="decimal"');
  expect(markup).toContain('aria-label="Разблокировать направляющую 2"');
  expect(markup).toContain("readOnly");
});
