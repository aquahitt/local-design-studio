import { test, expect } from "@playwright/test";
test.skip(!!process.env.STUDIO_LIBRARY_ROOT, "Generic fixture suite");
test("preview is read-only, rejection persists, and accepted changes match preview", async ({
  page,
}) => {
  await page.goto("/");
  const make = async (label: string) =>
    page.evaluate(async (label) => {
      const credentials = await fetch("/api/session").then((r) => r.json());
      const headers = {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      };
      const before = await fetch("/api/project", { headers }).then((r) =>
        r.json(),
      );
      const node = before.pages
        .flatMap((p: any) => p.nodes)
        .find((n: any) => n.type === "Text");
      const response = await fetch("/api/proposals", {
        method: "POST",
        headers,
        body: JSON.stringify({
          description: label,
          batch: {
            requestId: crypto.randomUUID(),
            baseRevision: before.revision,
            operations: [
              { type: "updateProps", nodeId: node.id, props: { text: label } },
              {
                type: "setTokens",
                tokens: {
                  ...before.tokens,
                  "review-accent": { type: "color", value: "#d74a64" },
                },
              },
            ],
          },
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      return {
        proposal: await response.json(),
        revision: before.revision,
        token: credentials.token,
      };
    }, label);
  const rejected = await make("Preview rejected edit");
  await page
    .getByRole("button", { name: "Предложения агента", exact: true })
    .click();
  const card = page.locator(".proposal-card").filter({
    has: page.getByRole("heading", {
      name: "Preview rejected edit",
      exact: true,
    }),
  });
  await expect(
    card.getByRole("heading", { name: "Сейчас", exact: true }),
  ).toBeVisible();
  await expect(
    card
      .frameLocator("iframe")
      .nth(1)
      .getByText("Preview rejected edit", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("#d74a64", { exact: true })).toBeVisible();
  const revision = () =>
    page.evaluate(
      (token) =>
        fetch("/api/project", { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => r.json())
          .then((p) => p.revision),
      rejected.token,
    );
  expect(await revision()).toBe(rejected.revision);
  await card.getByRole("button", { name: "Отклонить", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page
    .getByRole("button", { name: "История предложений", exact: true })
    .click();
  await expect(
    card.getByText("Предложение отклонено · проект не изменён"),
  ).toBeVisible();
  expect(await revision()).toBe(rejected.revision);
  await page.reload();
  await page
    .getByRole("button", { name: "Предложения агента", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page
    .getByRole("button", { name: "История предложений", exact: true })
    .click();
  await expect(
    card.getByText("Предложение отклонено · проект не изменён"),
  ).toBeVisible();
  const ready = await make("Preview accepted edit");
  await page.evaluate(async (id) => {
    const session = await fetch("/api/session").then((r) => r.json());
    const response = await fetch("/api/proposals/" + id + "/approve", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + session.token,
        "x-studio-ui-token": session.uiToken,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error(await response.text());
  }, ready.proposal.id);
  await page
    .getByRole("button", { name: "Ожидают решения", exact: true })
    .click();
  const accepted = page.locator(".proposal-card").filter({
    has: page.getByRole("heading", {
      name: "Preview accepted edit",
      exact: true,
    }),
  });
  await expect(accepted.getByText("approved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ожидают решения", exact: true }),
  ).toContainText("· 1");
  await expect(
    accepted
      .frameLocator("iframe")
      .nth(1)
      .getByText("Preview accepted edit", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/agent-proposal-preview.png",
    fullPage: true,
  });
  await accepted
    .getByRole("button", { name: "Подтвердить и применить" })
    .click();
  await expect(accepted).toHaveCount(0);
  await page
    .getByRole("button", { name: "История предложений", exact: true })
    .click();
  await expect(accepted.getByText("applied", { exact: true })).toBeVisible();
  await expect(page.locator(".proposal-card")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Подтвердить и применить" }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Предложения агента", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "История предложений", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(2);
  expect(await revision()).toBe(rejected.revision + 1);
});
