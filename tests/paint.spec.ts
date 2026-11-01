import { expect, test } from "@playwright/test";
import { selectStudioOption } from "./select-helpers";
import AxeBuilder from "@axe-core/playwright";
import { translate } from "../src/studio/locales";

// The fixture is a synthetic frame, not an invented demo component or private UI.
test("frame paints use one durable draft, actual preview, Undo and conflict recovery", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const project = await fetch("/api/project", { headers }).then((r) =>
      r.json(),
    );
    const node = {
      id: "paint-frame",
      type: "SceneFrame",
      name: "Paint frame",
      props: {},
      slots: {},
      scene: {
        kind: "frame",
        x: 30,
        y: 30,
        width: 200,
        height: 160,
        fill: "#123456",
        stroke: "#000000",
        strokeWidth: 4,
      },
    };
    const response = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
        operations: [
          {
            type: "addPage",
            page: {
              screenId: "paint-page",
              name: "Paint page",
              viewport: { width: 400, height: 300 },
              nodes: [node],
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return { headers, revision: (await response.json()).revision, node };
  });
  const read = () =>
    page.evaluate(async (headers) => {
      const project = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      );
      return {
        revision: project.revision,
        node: project.pages.find((p: any) => p.screenId === "paint-page")
          .nodes[0],
      };
    }, state.headers);
  await expect(page.getByTestId("save-status")).toContainText(
    `ревизия ${state.revision}`,
  );
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", "Paint page");
  await page
    .getByRole("button", { name: "Выделить paint-frame", exact: true })
    .click();
  const inspector = page.locator(".layout-inspector");
  await inspector
    .getByRole("button", { name: "Редактировать заливки", exact: true })
    .click();
  await expect(
    inspector.getByLabel("Цвет заливки 1", { exact: true }),
  ).toHaveValue("#123456");
  await selectStudioOption(page, "Тип заливки 1", "Линейный градиент");
  await inspector.getByLabel("Угол заливки 1", { exact: true }).fill("90");
  await inspector
    .getByLabel("Цвет точки 1 заливки 1", { exact: true })
    .fill("#ff0000");
  await inspector
    .getByLabel("Цвет точки 2 заливки 1", { exact: true })
    .fill("#0000ff");
  await inspector
    .getByRole("button", { name: "Добавить заливку", exact: true })
    .click();
  await inspector.getByLabel("Цвет заливки 1", { exact: true }).fill("#00ff00");
  await inspector
    .getByLabel("Непрозрачность заливки 1", { exact: true })
    .fill("0.5");
  await selectStudioOption(page, "Смешивание заливки 1", "Умножение");
  await inspector
    .getByRole("button", { name: "Добавить тень", exact: true })
    .click();
  await inspector.getByLabel("Размытие тени 1", { exact: true }).fill("12");
  const shadowX = inspector.getByLabel("X тени 1", { exact: true });
  await shadowX.fill("");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await shadowX.pressSequentially("-12.5");
  await expect(shadowX).toHaveValue("-12.5");
  const spread = inspector.getByLabel("Расширение тени 1", { exact: true });
  await spread.fill("");
  await spread.pressSequentially("-2");
  await expect(spread).toHaveValue("-2");
  const opacity = inspector.getByLabel("Непрозрачность заливки 1", {
    exact: true,
  });
  await opacity.fill("");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await opacity.pressSequentially("0.5");
  await expect(opacity).toHaveValue("0.5");

  expect((await read()).revision).toBe(state.revision);
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).revision)
    .toBe(state.revision + 1);
  const stored = (await read()).node;
  expect(stored.scene.fills).toHaveLength(2);
  expect(stored.scene.fills[0].blendMode).toBe("multiply");
  expect(stored.scene.fills[1].kind).toBe("linear");
  expect(stored.scene.shadows[0]).toMatchObject({
    blur: 12,
    x: -12.5,
    spread: -2,
  });
  const preview = page.frameLocator('iframe[title="Экран Paint page"]');
  const frame = preview.locator('[data-node-id="paint-frame"]');
  await expect
    .poll(() => frame.evaluate((el) => getComputedStyle(el).backgroundImage))
    .toContain("90deg");
  await expect
    .poll(() => frame.evaluate((el) => getComputedStyle(el).boxShadow))
    .toContain("12px");
  await expect
    .poll(() =>
      frame.evaluate((el) => getComputedStyle(el).backgroundBlendMode),
    )
    .toContain("multiply");
  await inspector
    .getByRole("button", { name: "Опустить заливку 1", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).revision)
    .toBe(state.revision + 2);
  expect((await read()).node.scene.fills.map((p: any) => p.id)).toEqual(
    stored.scene.fills.map((p: any) => p.id).reverse(),
  );
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).node.scene)
    .toEqual(stored.scene);
  await page.reload();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", "Paint page");
  await page
    .getByRole("button", { name: "Выделить paint-frame", exact: true })
    .click();
  await expect(
    inspector.getByLabel("Непрозрачность заливки 1", { exact: true }),
  ).toHaveValue("0.5");
  const pendingX = inspector.getByLabel("X тени 1", { exact: true });
  await pendingX.fill("");
  await pendingX.pressSequentially("-");
  await expect(pendingX).toHaveValue("-");
  await page.evaluate(async (headers) => {
    const project = await fetch("/api/project", { headers }).then((r) =>
      r.json(),
    );
    const node = project.pages.find((p: any) => p.screenId === "paint-page")
      .nodes[0];
    const response = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
        operations: [
          {
            type: "setNodeMetadata",
            nodeId: node.id,
            scene: {
              shadows: node.scene.shadows.map((shadow: any) => ({
                ...shadow,
                x: 123,
              })),
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, state.headers);
  await expect(inspector.getByRole("status")).toContainText(
    "Документ изменился. Ввод сохранён.",
  );
  await expect(pendingX).toHaveValue("-");
  await expect(pendingX).toBeFocused();
  await pendingX.pressSequentially("7.5");
  await expect(pendingX).toHaveValue("-7.5");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await inspector
    .getByRole("button", { name: "Сбросить слой", exact: true })
    .click();
  await expect(pendingX).toHaveValue("123");
  await inspector
    .getByLabel("Непрозрачность заливки 1", { exact: true })
    .fill("0.3");
  await page.evaluate(async (headers) => {
    const project = await fetch("/api/project", { headers }).then((r) =>
      r.json(),
    );
    const response = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
        operations: [
          {
            type: "setNodeMetadata",
            nodeId: "paint-frame",
            name: "External name",
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, state.headers);
  await expect(inspector.getByRole("status")).toContainText(
    "Документ изменился. Ввод сохранён.",
  );
  await expect(
    inspector.getByLabel("Непрозрачность заливки 1", { exact: true }),
  ).toHaveValue("0.3");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await inspector
    .getByRole("button", { name: "Сбросить слой", exact: true })
    .click();
  await inspector
    .getByLabel("Непрозрачность заливки 1", { exact: true })
    .fill("2");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeDisabled();
  await expect(inspector.getByRole("alert")).toBeVisible();
  await inspector
    .getByLabel("Непрозрачность заливки 1", { exact: true })
    .fill("0.7");
  await expect(
    inspector.getByRole("button", { name: "Применить слой", exact: true }),
  ).toBeEnabled();
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).node.scene.fills[0].opacity)
    .toBe(0.7);
  // Disabled and empty stacks must not resurrect the preserved legacy fill.
  await inspector
    .getByRole("button", { name: "Скрыть заливку 1", exact: true })
    .click();
  await inspector
    .getByRole("button", { name: "Скрыть заливку 2", exact: true })
    .click();
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(() => frame.evaluate((el) => getComputedStyle(el).backgroundImage))
    .toBe("none");
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect(
    inspector.getByRole("button", { name: "Скрыть заливку 1", exact: true }),
  ).toBeVisible();
  const removeFill = inspector.getByRole("button", {
    name: "Удалить заливку 1",
    exact: true,
  });
  await removeFill.focus();
  await page.keyboard.press("Enter");
  await expect(removeFill).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    inspector.getByRole("button", { name: "Добавить заливку", exact: true }),
  ).toBeFocused();
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(() => frame.evaluate((el) => getComputedStyle(el).backgroundImage))
    .toBe("none");
  expect((await read()).node.scene).toMatchObject({
    fills: [],
    fill: "#123456",
  });
  await inspector
    .getByRole("button", { name: "Добавить заливку", exact: true })
    .click();
  await selectStudioOption(page, "Тип заливки 1", "Радиальный градиент");
  await inspector.getByLabel("Центр X заливки 1", { exact: true }).fill("0.3");
  await inspector.getByLabel("Радиус Y заливки 1", { exact: true }).fill("0.7");
  await inspector
    .getByRole("button", { name: "Добавить точку заливки 1", exact: true })
    .click();
  await inspector
    .getByRole("button", { name: "Удалить точку 3 заливки 1", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    inspector.getByRole("button", {
      name: "Добавить точку заливки 1",
      exact: true,
    }),
  ).toBeFocused();
  await selectStudioOption(page, "Тип тени 1", "Внутренняя");
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(() => frame.evaluate((el) => getComputedStyle(el).backgroundImage))
    .toContain("radial-gradient");
  expect((await read()).node.scene.fills[0]).toMatchObject({
    kind: "radial",
    center: { x: 0.3, y: 0.5 },
    radius: { x: 0.5, y: 0.7 },
  });
});

test("invalid advanced paint JSON preserves the draft and can be repaired without crashing", async ({
  page,
}) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const project = await fetch("/api/project", { headers }).then((r) =>
      r.json(),
    );
    const node = {
      id: "paint-repair-frame",
      type: "SceneFrame",
      name: "Repair frame",
      props: {},
      slots: {},
      scene: {
        kind: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: "#123456",
      },
    };
    const response = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
        operations: [
          {
            type: "addPage",
            page: {
              screenId: "paint-repair-page",
              name: "Repair page",
              viewport: { width: 400, height: 300 },
              nodes: [node],
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return { headers, revision: (await response.json()).revision, node };
  });
  await expect(page.getByTestId("save-status")).toContainText(
    `ревизия ${state.revision}`,
  );
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", "Repair page");
  await page
    .getByRole("button", { name: "Выделить paint-repair-frame", exact: true })
    .click();
  const inspector = page.locator(".layout-inspector");
  const editor = inspector.getByLabel("Параметры слоя JSON", { exact: true });
  const invalidDrafts = [
    {
      name: "Unlost draft",
      scene: {
        ...state.node.scene,
        shadows: [
          {
            id: "bad-shadow",
            kind: { toString: null },
            x: 0,
            y: 0,
            blur: 0,
            spread: 0,
            color: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      },
    },
    { name: "Unlost draft", scene: { ...state.node.scene, fills: [{}] } },
    {
      name: "Unlost draft",
      scene: {
        ...state.node.scene,
        fills: [{ id: "broken", kind: "solid", color: null }],
      },
    },
    { name: "Unlost draft", scene: { ...state.node.scene, fills: "x" } },
    { name: "Unlost draft", scene: { ...state.node.scene, fill: {} } },
    { name: "Unlost draft", scene: { ...state.node.scene, fill: null } },
    null,
  ];
  for (const invalidValue of invalidDrafts) {
    const invalid = JSON.stringify(invalidValue, null, 2);
    await editor.fill(invalid);
    await expect(editor).toHaveValue(invalid);
    await expect(inspector.getByRole("alert")).toBeVisible();
    await expect(
      inspector.getByRole("button", { name: "Применить слой", exact: true }),
    ).toBeDisabled();
    expect(crashes).toEqual([]);
  }
  const fixed = {
    name: "Repaired draft",
    scene: {
      ...state.node.scene,
      fills: [
        {
          id: "repaired",
          kind: "solid",
          color: { r: 255, g: 0, b: 0, a: 0.5 },
        },
      ],
    },
  };
  await editor.fill(JSON.stringify(fixed, null, 2));
  await expect(
    inspector.getByLabel("Цвет заливки 1", { exact: true }),
  ).toHaveValue("#ff0000");
  await inspector
    .getByRole("button", { name: "Применить слой", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async (headers) => {
        const project = await fetch("/api/project", { headers }).then((r) =>
          r.json(),
        );
        return {
          revision: project.revision,
          node: project.pages.find(
            (p: any) => p.screenId === "paint-repair-page",
          ).nodes[0],
        };
      }, state.headers),
    )
    .toMatchObject({ revision: state.revision + 1, node: fixed });
  expect(crashes).toEqual([]);
});

for (const locale of ["ru", "en"] as const)
  for (const theme of ["light", "dark"] as const) {
    test(`${locale}/${theme}: paint controls expose keyboard actions and accessible colors`, async ({
      page,
    }, testInfo) => {
      const t = (source: string, values?: Record<string, string | number>) =>
        translate(locale, source, values);
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem("local-design-studio:locale", locale);
          localStorage.setItem("local-design-studio:interface-theme", theme);
        },
        { locale, theme },
      );
      await page.goto("/");
      const frameId = `paint-keyboard-${locale}-${theme}`;
      const revision = await page.evaluate(async (frameId) => {
        const session = await fetch("/api/session").then((r) => r.json());
        const headers = {
          Authorization: `Bearer ${session.token}`,
          "x-studio-ui-token": session.uiToken,
          "Content-Type": "application/json",
        };
        const project = await fetch("/api/project", { headers }).then((r) =>
          r.json(),
        );
        const response = await fetch("/api/operations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            baseRevision: project.revision,
            operations: [
              {
                type: "addPage",
                page: {
                  screenId: frameId,
                  name: frameId,
                  viewport: { width: 400, height: 300 },
                  nodes: [
                    {
                      id: frameId,
                      type: "SceneFrame",
                      name: frameId,
                      props: {},
                      slots: {},
                      scene: {
                        kind: "frame",
                        x: 0,
                        y: 0,
                        width: 200,
                        height: 200,
                        strokes: [
                          {
                            id: "stroke",
                            kind: "solid",
                            color: { r: 30, g: 100, b: 200, a: 0.7 },
                            width: 4,
                            alignment: "outside",
                          },
                        ],
                        fills: [
                          {
                            id: "fill",
                            kind: "solid",
                            color: { r: 120, g: 30, b: 90, a: 0.8 },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()).revision;
      }, frameId);
      await expect(page.getByTestId("save-status")).toContainText(
        String(revision),
      );
      await page
        .getByRole("button", { name: t("Экраны"), exact: true })
        .click();
      await selectStudioOption(page, t("Экран"), frameId);
      await page
        .getByRole("button", {
          name: `${t("Выделить")} ${frameId}`,
          exact: true,
        })
        .click();
      const inspector = page.locator(".layout-inspector");
      const paint = inspector.getByRole("group", {
        name: t("Заливки и тени фрейма"),
        exact: true,
      });
      await expect(paint).toBeVisible();
      // Enter via actual Tab navigation from the preceding geometry control.
      await inspector.getByLabel(t("Радиус слоя"), { exact: true }).focus();
      await page.keyboard.press("Tab");
      const hide = paint.getByRole("button", {
        name: t("Скрыть заливку {0}", { 0: 1 }),
        exact: true,
      });
      await expect(hide).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        paint.getByRole("button", {
          name: t("Показать заливку {0}", { 0: 1 }),
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      const type = paint.getByRole("combobox", {
        name: t("Тип заливки {0}", { 0: 1 }),
        exact: true,
      });
      await type.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(
        paint.getByLabel(t("Угол заливки {0}", { 0: 1 }), { exact: true }),
      ).toBeVisible();
      const strokes = inspector.getByRole("group", {
        name: t("Обводки фрейма"),
        exact: true,
      });
      await expect(strokes).toBeVisible();
      await paint
        .getByRole("button", { name: t("Добавить тень"), exact: true })
        .focus();
      await page.keyboard.press("Tab");
      const hideStroke = strokes.getByRole("button", {
        name: t("Скрыть обводку {0}", { 0: 1 }),
        exact: true,
      });
      await expect(hideStroke).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        strokes.getByRole("button", {
          name: t("Показать обводку {0}", { 0: 1 }),
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const strokeWidth = strokes.getByLabel(
        t("Ширина обводки {0}", { 0: 1 }),
        { exact: true },
      );
      await expect(strokeWidth).toBeFocused();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("1e");
      await expect(strokeWidth).toHaveValue("1e");
      await expect(
        inspector.getByRole("button", {
          name: t("Применить слой"),
          exact: true,
        }),
      ).toBeDisabled();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("4");
      await expect(
        inspector.getByRole("button", {
          name: t("Применить слой"),
          exact: true,
        }),
      ).toBeEnabled();
      await strokes.screenshot({
        path: testInfo.outputPath(`strokes-${locale}-${theme}.png`),
      });
      const audit = await new AxeBuilder({ page })
        .include(".layout-inspector")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      const undersized = await inspector
        .locator(".paint-fields input,.paint-fields button")
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                (rect.width < 39.9 || rect.height < 39.9)
              );
            })
            .map((el) => el.getAttribute("aria-label")),
        );
      expect(undersized).toEqual([]);
      const overflow = await inspector
        .locator(".paint-row")
        .evaluateAll((rows) =>
          rows.flatMap((row) => {
            const outer = row.getBoundingClientRect();
            return [...row.querySelectorAll("input,button")]
              .filter((control) => {
                const rect = control.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  (rect.left < outer.left - 1 || rect.right > outer.right + 1)
                );
              })
              .map((control) => control.getAttribute("aria-label"));
          }),
        );
      expect(overflow).toEqual([]);
      await paint.screenshot({
        path: testInfo.outputPath(`paint-${locale}-${theme}.png`),
      });
    });
  }
