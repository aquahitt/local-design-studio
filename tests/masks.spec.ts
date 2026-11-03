import { expect, test, type Page } from "@playwright/test";
async function mount(
  page: Page,
  mode: "alpha" | "luminance",
  variant = "bands",
) {
  await page.goto("/preview");
  return page.evaluate(
    async ({ mode, variant }) => {
      const sourceModule = "/src/core/mask-source.ts",
        svgModule = "/src/core/mask-svg.ts",
        projectModule = "/src/core/project.ts",
        fixtureModule = "/src/core/scene-fixtures.ts";
      const [
        { compileMaskSource },
        { serializeMaskSVG },
        { parseProject },
        { sceneProject },
      ] = await Promise.all([
        import(sourceModule),
        import(svgModule),
        import(projectModule),
        import(fixtureModule),
      ]);
      const source: any = {
        id: "source",
        type: "SceneFrame",
        maskSource: true,
        props: {},
        slots: {},
        scene: {
          kind: "frame",
          x: 20,
          y: 20,
          width: 100,
          height: 60,
          fills: [
            {
              id: "bands",
              kind: "linear",
              angle: 90,
              stops: [
                { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
                { offset: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
                { offset: 0.5, color: { r: 255, g: 255, b: 255, a: 1 } },
                { offset: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
              ],
            },
          ],
        },
      };
      if (variant === "rotated")
        source.scene = {
          kind: "vector",
          x: 100,
          y: 40,
          width: 60,
          height: 40,
          rotation: 90,
          path: "M0 0H60V40H0Z",
          fill: "#fff",
        };
      if (variant === "triangle")
        source.scene = {
          kind: "vector",
          x: 20,
          y: 20,
          width: 100,
          height: 100,
          path: "M0 0H100L0 100Z",
          fill: "#fff",
        };
      if (variant === "stroke") {
        source.scene = {
          kind: "frame",
          x: 60,
          y: 50,
          width: 80,
          height: 60,
          radius: 12,
          fill: "#fff",
          clip: true,
          strokes: [
            {
              id: "outer",
              kind: "solid",
              color: { r: 255, g: 255, b: 255, a: 1 },
              width: 8,
              alignment: "outside",
            },
          ],
        };
        source.slots.children = [
          {
            id: "clipped",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame",
              x: 75,
              y: 10,
              width: 40,
              height: 40,
              fill: "#00f",
            },
          },
        ];
      }
      if (variant === "shadow")
        source.scene = {
          kind: "frame",
          x: 60,
          y: 50,
          width: 80,
          height: 60,
          fill: "#fff",
          shadows: [
            {
              id: "shadow",
              kind: "outer",
              x: 20,
              y: 0,
              blur: 4,
              spread: 0,
              color: { r: 255, g: 255, b: 255, a: 1 },
            },
          ],
        };
      if (variant === "unsupported")
        source.scene = {
          kind: "component",
          x: 20,
          y: 20,
          width: 100,
          height: 60,
        };
      const mask: any = {
        id: "mask",
        type: "SceneMask",
        props: {},
        scene: {
          kind: "mask",
          maskMode: mode,
          x: 0,
          y: 0,
          width: 300,
          height: 200,
        },
        slots: { children: [source] },
      };
      const project = sceneProject();
      project.pages[0].nodes = [mask];
      const canonical = parseProject(project);
      const descriptor = compileMaskSource(
        canonical,
        canonical.pages[0].nodes[0],
      );
      const result = serializeMaskSVG(descriptor);
      document.body.innerHTML = "";
      Object.assign(document.body.style, { margin: "0", background: "white" });
      const host = document.createElement("div");
      host.id = "host";
      Object.assign(host.style, {
        position: "relative",
        width: "300px",
        height: "200px",
        background: "white",
      });
      const envelope = document.createElement("div"),
        inner = document.createElement("div"),
        content = document.createElement("div");
      const b = descriptor.bounds;
      Object.assign(envelope.style, {
        position: "absolute",
        left: b.x + "px",
        top: b.y + "px",
        width: b.width + "px",
        height: b.height + "px",
        maskImage: result.maskImage,
        maskMode: mode,
        maskRepeat: "no-repeat",
        maskPosition: "0 0",
        maskSize: "100% 100%",
        maskOrigin: "border-box",
        maskClip: "border-box",
      });
      Object.assign(inner.style, {
        position: "absolute",
        left: -b.x + "px",
        top: -b.y + "px",
        width: "300px",
        height: "200px",
      });
      Object.assign(content.style, {
        position: "absolute",
        inset: "0",
        background: "red",
      });
      inner.append(content);
      envelope.append(inner);
      host.append(envelope);
      document.body.append(host);
      const image = new Image();
      image.src = "data:image/svg+xml," + encodeURIComponent(result.svg);
      await image.decode();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      return { bounds: b, diagnostics: result.diagnostics };
    },
    { mode, variant },
  );
}
async function pixels(page: Page, points: number[][]) {
  const png = await page.locator("#host").screenshot();
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    },
    { data: png.toString("base64"), points },
  );
}
test("data-SVG compiler distinguishes source alpha from luminance over unchanged HTML content", async ({
  page,
}) => {
  for (const mode of ["alpha", "luminance"] as const) {
    const result = await mount(page, mode);
    expect(result.diagnostics).toEqual([]);
    expect(
      await pixels(page, [
        [30, 40],
        [100, 40],
        [10, 40],
      ]),
    ).toEqual([
      mode === "alpha" ? [255, 0, 0, 255] : [255, 255, 255, 255],
      [255, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
  }
});
test("source affine transforms retain their local paint coordinates inside the finite SVG envelope", async ({
  page,
}) => {
  const result = await mount(page, "alpha", "rotated");
  expect(result.diagnostics).toEqual([]);
  expect(result.bounds).toMatchObject({ x: 60, y: 40, width: 40, height: 60 });
  expect(
    await pixels(page, [
      [80, 70],
      [110, 70],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [255, 255, 255, 255],
  ]);
});
test("rounded outside stroke survives own clipping while overflowing children stay clipped", async ({
  page,
}) => {
  const result = await mount(page, "alpha", "stroke");
  expect(result.diagnostics).toEqual([]);
  expect(result.bounds).toEqual({ x: 52, y: 42, width: 96, height: 76 });
  expect(
    await pixels(page, [
      [55, 80],
      [54, 44],
      [145, 80],
      [155, 70],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 0, 0, 255],
    [255, 255, 255, 255],
  ]);
});
test("blurred source shadow is included without an opaque source placeholder", async ({
  page,
}) => {
  const result = await mount(page, "alpha", "shadow");
  expect(result.diagnostics).toEqual([]);
  const resultPixels = await pixels(page, [
    [162, 80],
    [173, 80],
    [60, 36],
  ]);
  expect(resultPixels[0][0]).toBe(255);
  expect(resultPixels[0][1]).toBeLessThan(255);
  expect(resultPixels[1]).toEqual([255, 255, 255, 255]);
  expect(resultPixels[2]).toEqual([255, 255, 255, 255]);
});
test("unsupported source hides all content instead of exposing an error glyph or an unmasked surface", async ({
  page,
}) => {
  const result = await mount(page, "alpha", "unsupported");
  expect(result.diagnostics[0].code).toBe("MASK_SOURCE_UNSUPPORTED");
  expect(
    await pixels(page, [
      [30, 40],
      [100, 40],
    ]),
  ).toEqual([
    [255, 255, 255, 255],
    [255, 255, 255, 255],
  ]);
});

test("nonrectangular vector source preserves transparent corners in both mask modes", async ({
  page,
}) => {
  for (const mode of ["alpha", "luminance"] as const) {
    expect((await mount(page, mode, "triangle")).diagnostics).toEqual([]);
    expect(
      await pixels(page, [
        [30, 30],
        [110, 110],
      ]),
    ).toEqual([
      [255, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
  }
});
