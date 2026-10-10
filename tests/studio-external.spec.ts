import { test, expect } from "@playwright/test";
test.skip(
  !process.env.STUDIO_LIBRARY_ROOT?.endsWith("/examples/library/external"),
  "Opt-in standalone library",
);
test("standalone external library is registered, rendered and saved", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("catalog-count")).toContainText("1");
  const frame = page.frameLocator("iframe").first();
  await expect(
    frame.getByText("A component from an explicitly enabled library"),
  ).toBeVisible();
  const credentials = await page.evaluate(async () =>
    fetch("/api/session").then((r) => r.json()),
  );
  const libraries = await page.evaluate(
    async ({ token }) =>
      fetch("/api/components", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    credentials,
  );
  expect(
    libraries.some((l: { id: string }) => l.id === "external-example"),
  ).toBe(true);
  await page.getByRole("button", { name: "На экран +" }).click();
  await expect(page.getByLabel("Свойства JSON")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Экраны", exact: true }).click();
  await expect(
    page
      .frameLocator("iframe")
      .first()
      .getByText("A component from an explicitly enabled library"),
  ).toHaveCount(2);
});
