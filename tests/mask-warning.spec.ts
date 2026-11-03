import { expect, test } from "@playwright/test";
import { parseProject } from "../src/core/project";
import { sceneProject } from "../src/core/scene-fixtures";
test("editor explains a failed mask outside the product preview instead of silently showing empty content", async ({
  page,
}) => {
  const project = parseProject(sceneProject());
  project.library = { id: "builtin", version: "1" };
  project.pages[0].nodes = [
    {
      id: "mask",
      name: "Test mask",
      type: "SceneMask",
      props: {},
      scene: {
        kind: "mask",
        maskMode: "alpha",
        x: 0,
        y: 0,
        width: 300,
        height: 200,
      },
      slots: {
        children: [
          {
            id: "source",
            type: "Button",
            maskSource: true,
            props: { label: "Unsupported source" },
            slots: {},
            scene: { kind: "component", x: 20, y: 20, width: 100, height: 60 },
          },
          {
            id: "content",
            type: "SceneFrame",
            props: {},
            slots: {},
            scene: {
              kind: "frame",
              x: 0,
              y: 0,
              width: 300,
              height: 200,
              fill: "#f00",
            },
          },
        ],
      },
    },
  ];
  await page.route("**/api/project", async (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: project })
      : route.continue(),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await expect(
    page.getByText("Не удалось подготовить маски. Проверь их источники:", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Не удалось подготовить маски. Проверь их источники:", {
      exact: false,
    }),
  ).toContainText("Test mask");
});
