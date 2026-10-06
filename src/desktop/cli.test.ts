import { expect, it } from "vitest";
import { desktopMcpArgs } from "../../desktop/cli";
it("keeps GUI launches out of the MCP path", () =>
  expect(desktopMcpArgs(["app"])).toBeNull());
it("accepts only an explicit project path without loading document paths", () => {
  expect(
    desktopMcpArgs(["app", "--studio-mcp", "--project", "/tmp/project"]),
  ).toEqual(["--project", "/tmp/project"]);
  expect(() => desktopMcpArgs(["app", "--studio-mcp"])).toThrow(
    "MCP_PROJECT_REQUIRED",
  );
  expect(() =>
    desktopMcpArgs([
      "app",
      "--studio-mcp",
      "--project",
      "/tmp/project",
      "--unsafe",
    ]),
  ).toThrow("MCP_INVALID_ARGUMENTS");
});
