import { expect, test, type Page } from "@playwright/test";
import type { Project } from "../src/core/project";
async function read(page: Page): Promise<Project> {
  return page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    return fetch("/api/project", {
      headers: { Authorization: "Bearer " + session.token },
    }).then((r) => r.json());
  });
}
async function edit(page: Page, operations: unknown[]) {
  return page.evaluate(async (operations) => {
    const session = await fetch("/api/session").then((r) => r.json()),
      headers = {
        Authorization: "Bearer " + session.token,
        "Content-Type": "application/json",
        "x-studio-ui-token": session.uiToken,
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
        operations,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, operations);
}
async function setup(page: Page) {
  await page.goto("/");
  const before = await read(page),
    pageId = before.pages[0].screenId,
    prefix = "mask-ui-" + Date.now();
  const source = prefix + "-source",
    content = prefix + "-content";
  await edit(page, [
    {
      type: "insertNode",
      pageId,
      index: before.pages[0].nodes.length,
      node: {
        id: source,
        type: "SceneFrame",
        name: "White source",
        props: {},
        slots: {},
        scene: {
          kind: "frame",
          x: 40,
          y: 40,
          width: 80,
          height: 80,
          fill: "#fff",
        },
      },
    },
    {
      type: "insertNode",
      pageId,
      index: before.pages[0].nodes.length + 1,
      node: {
        id: content,
        type: "SceneFrame",
        name: "Red content",
        props: {},
        slots: {},
        scene: {
          kind: "frame",
          x: 20,
          y: 20,
          width: 200,
          height: 120,
          fill: "#f00",
        },
      },
    },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделить " + source, exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Выбрать слой Red content", exact: true })
    .check();
  await page.locator(".mask-actions summary").click();
  await page
    .getByRole("combobox", { name: "Источник маски", exact: true })
    .click();
  await page.getByRole("option", { name: "White source", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать маску", exact: true })
    .click();
  let groupId = "";
  await expect
    .poll(async () => {
      const p = await read(page);
      const group = p.pages[0].nodes.find(
        (n) =>
          n.scene?.kind === "mask" &&
          n.slots.children.some((c) => c.id === source),
      );
      groupId = group?.id ?? "";
      return groupId;
    })
    .not.toBe("");
  return { source, content, groupId };
}
test("mask controls create one durable group, preserve dirty choices across external revisions and remove masking without losing group opacity", async ({
  page,
}) => {
  test.setTimeout(45000);
  const ids = await setup(page);
  const first = await read(page),
    group = first.pages[0].nodes.find((n) => n.id === ids.groupId)!;
  expect(group.slots.children.map((n) => [n.id, !!n.maskSource])).toEqual([
    [ids.source, true],
    [ids.content, false],
  ]);
  await page
    .getByRole("combobox", { name: "Режим маски", exact: true })
    .click();
  await page
    .getByRole("option", { name: "По яркости (luminance)", exact: true })
    .click();
  expect((await read(page)).revision).toBe(first.revision);
  await edit(page, [
    { type: "setNodeMetadata", nodeId: ids.content, name: "External label" },
  ]);
  await expect(
    page.getByText(
      "Документ изменился. Обнови основу маски или сбрось изменения.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Применить маску", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Режим маски", exact: true }),
  ).toContainText("По яркости");
  await page
    .getByRole("button", { name: "Обновить основу маски", exact: true })
    .click();
  const rebased = await read(page);
  expect(
    rebased.pages[0].nodes.find((n) => n.id === ids.groupId)!.scene!.maskMode,
  ).toBe("alpha");
  await page
    .getByRole("button", { name: "Применить маску", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = await read(page);
      return p.pages[0].nodes.find((n) => n.id === ids.groupId)?.scene
        ?.maskMode;
    })
    .toBe("luminance");
  const applied = await read(page);
  expect(
    applied.pages[0].nodes.find((n) => n.id === ids.groupId)!.slots.children[1]
      .name,
  ).toBe("External label");
  await edit(page, [
    { type: "setNodeMetadata", nodeId: ids.groupId, scene: { opacity: 0.4 } },
  ]);
  await expect(
    page.getByRole("button", { name: "Разгруппировать маску", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Снять маску", exact: true }).click();
  await expect
    .poll(async () => {
      const p = await read(page);
      return p.pages[0].nodes.find((n) => n.id === ids.groupId)?.scene?.kind;
    })
    .toBe("frame");
  const released = (await read(page)).pages[0].nodes.find(
    (n) => n.id === ids.groupId,
  )!;
  expect(released.scene!.opacity).toBe(0.4);
  expect(released.slots.children.map((n) => n.id)).toEqual([
    ids.source,
    ids.content,
  ]);
  expect(released.slots.children.every((n) => !n.maskSource)).toBe(true);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = await read(page);
      return p.pages[0].nodes.find((n) => n.id === ids.groupId)?.scene?.kind;
    })
    .toBe("mask");
  expect(
    (await read(page)).pages[0].nodes.find((n) => n.id === ids.groupId)!.scene!
      .opacity,
  ).toBe(0.4);
});
test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  const project = await read(page),
    operations: unknown[] = [];
  const owned = (node: any): boolean =>
    node.id.startsWith("mask-ui-") ||
    Object.values(node.slots).some((rows: any) => rows.some(owned));
  const unlock = (node: any) => {
    if (node.locked)
      operations.push({
        type: "setNodeMetadata",
        nodeId: node.id,
        locked: false,
      });
    Object.values(node.slots).forEach((rows: any) => rows.forEach(unlock));
  };
  for (const screen of project.pages)
    for (const node of screen.nodes)
      if (owned(node)) {
        unlock(node);
        operations.push({ type: "removeNode", nodeId: node.id });
      }
  if (operations.length) await edit(page, operations);
});
test("source editing, safe deletion guards and source changes retain canonical order and respect masked content locks", async ({
  page,
}) => {
  const ids = await setup(page);
  await page
    .getByRole("button", { name: "Редактировать источник", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Удалить выбранные", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Удалить слой", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Сначала сними маску или выбери другой источник.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Настроить маску", exact: true })
    .click();
  const before = (await read(page)).pages[0].nodes.find(
    (n) => n.id === ids.groupId,
  )!;
  await page
    .getByRole("combobox", { name: "Источник маски", exact: true })
    .click();
  await page.getByRole("option", { name: "Red content", exact: true }).click();
  await page
    .getByRole("button", { name: "Применить маску", exact: true })
    .click();
  await expect
    .poll(async () => {
      const p = await read(page);
      return p.pages[0].nodes
        .find((n) => n.id === ids.groupId)!
        .slots.children.find((n) => n.maskSource)?.id;
    })
    .toBe(ids.content);
  const changed = (await read(page)).pages[0].nodes.find(
    (n) => n.id === ids.groupId,
  )!;
  expect(changed.slots.children.map((n) => n.id)).toEqual(
    before.slots.children.map((n) => n.id),
  );
  expect(changed.slots.children.map((n) => n.scene)).toEqual(
    before.slots.children.map((n) => n.scene),
  );
  await edit(page, [
    { type: "setNodeMetadata", nodeId: ids.source, locked: true },
  ]);
  await expect(
    page.getByRole("combobox", { name: "Режим маски", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Выделить " + ids.source, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Разблокировать", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выделить " + ids.groupId, exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Режим маски", exact: true }),
  ).toBeEnabled();
});
