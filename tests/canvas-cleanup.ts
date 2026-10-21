import { expect, type APIRequestContext } from "@playwright/test";
export async function cleanupCanvasPages(
  request: APIRequestContext,
  prefix: string,
) {
  const response = await request.get("/api/session");
  const session = await response.json();
  const headers = {
    Origin: new URL(response.url()).origin,
    Authorization: `Bearer ${session.token}`,
    "x-studio-ui-token": session.uiToken,
  };
  const project = await (await request.get("/api/project", { headers })).json();
  const pages = project.pages.filter((page: { screenId: string }) =>
    page.screenId.startsWith(prefix),
  );
  if (!pages.length) return;
  const result = await request.post("/api/operations", {
    headers,
    data: {
      requestId: crypto.randomUUID(),
      baseRevision: project.revision,
      operations: pages.map((page: { screenId: string }) => ({
        type: "removePage",
        pageId: page.screenId,
      })),
    },
  });
  expect(result.ok(), await result.text()).toBe(true);
}
