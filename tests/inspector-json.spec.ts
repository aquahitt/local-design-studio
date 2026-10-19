import { expect, test, type Page } from "@playwright/test";
import type { Project, ProjectNode } from "../src/core/project";
import { selectStudioOption } from "./select-helpers";

// Seed only synthetic data through the authenticated API of the temporary
// project owned by playwright.config.ts. Never open a user's design project.
async function seedFrame(page: Page) {
  await page.goto("/");
  const fixture = await page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "x-studio-ui-token": session.uiToken,
      "Content-Type": "application/json",
    };
    const project: Project = await fetch("/api/project", { headers }).then(
      (r) => r.json(),
    );
    const id = crypto.randomUUID();
    const node: ProjectNode = {
      id: `inspector-frame-${id}`,
      type: "SceneFrame",
      name: "Inspector JSON frame",
      props: {},
      slots: {},
      scene: {
        kind: "frame",
        x: 30,
        y: 40,
        width: 200,
        height: 160,
        fill: "#123456",
      },
    };
    const screenId = `inspector-page-${id}`;
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
              screenId,
              name: screenId,
              viewport: { width: 400, height: 300 },
              nodes: [node],
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const baseline: Project = await response.json();
    return { headers, baseline, node, screenId };
  });
  await expect(page.getByTestId("save-status")).toContainText(
    `ревизия ${fixture.baseline.revision}`,
  );
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await selectStudioOption(page, "Экран", fixture.screenId);
  await page
    .getByRole("button", { name: `Выделить ${fixture.node.id}`, exact: true })
    .click();
  const read = () =>
    page.evaluate(async (headers): Promise<Project> => {
      const response = await fetch("/api/project", { headers });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }, fixture.headers);
  return { ...fixture, read };
}

for (const field of ["name", "scene.width"] as const) {
  test(`advanced layer JSON rejects an object in ${field} without losing the editor`, async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
      console.error(`[inspector JSON ${field}] pageerror: ${error.stack}`);
    });
    const { node, baseline, read, screenId } = await seedFrame(page);
    const inspector = page.locator(".layout-inspector");
    const json = inspector.getByRole("textbox", {
      name: "Параметры слоя JSON",
      exact: true,
    });
    const apply = inspector.getByRole("button", {
      name: "Применить слой",
      exact: true,
    });
    const valid = { name: node.name, scene: node.scene };
    const invalid = JSON.stringify(
      field === "name"
        ? { ...valid, name: { toString: null } }
        : { ...valid, scene: { ...node.scene, width: { toString: null } } },
      null,
      2,
    );

    await json.fill(invalid);
    // Read the durable document after the input event has rendered. This also
    // lets pageerror capture reveal React coercion failures without a locator
    // timeout hiding the underlying error.
    expect(await read()).toEqual(baseline);
    await testInfo.attach("browser-errors", {
      body: JSON.stringify(pageErrors, null, 2),
      contentType: "application/json",
    });
    expect(
      pageErrors,
      "structurally invalid JSON must not crash React",
    ).toEqual([]);
    await expect(json).toHaveValue(invalid);
    await expect(json).toBeFocused();
    await expect(inspector.getByRole("alert")).toBeVisible();
    await expect(apply).toBeDisabled();
    await expect(page.getByTestId("selection")).toContainText(node.id);
    await expect(
      page.getByRole("button", {
        name: `Выделить ${node.id}`,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page
        .frameLocator(`iframe[title="Экран ${screenId}"]`)
        .locator(`[data-node-id="${node.id}"]`),
    ).toBeVisible();

    const corrected = {
      name: "Corrected inspector frame",
      scene: { ...node.scene!, width: 240 },
    };
    await json.fill(JSON.stringify(corrected, null, 2));
    await expect(json).toBeFocused();
    await expect(inspector.getByRole("alert")).toHaveCount(0);
    await expect(apply).toBeEnabled();
    await apply.click();
    const edited: Project = {
      ...baseline,
      revision: baseline.revision + 1,
      pages: baseline.pages.map((screen) =>
        screen.screenId === screenId
          ? { ...screen, nodes: [{ ...node, ...corrected }] }
          : screen,
      ),
    };
    await expect.poll(read).toEqual(edited);
    await expect(
      inspector.getByLabel("Название слоя", { exact: true }),
    ).toHaveValue(corrected.name);
    await expect(
      inspector.getByLabel("Ширина слоя", { exact: true }),
    ).toHaveValue("240");
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await expect.poll(read).toEqual({
      ...baseline,
      revision: baseline.revision + 2,
    });
    await expect(
      inspector.getByLabel("Название слоя", { exact: true }),
    ).toHaveValue(node.name!);
    await expect(
      inspector.getByLabel("Ширина слоя", { exact: true }),
    ).toHaveValue("200");
    expect(pageErrors).toEqual([]);
  });
}
