/** Installed MCP mode intentionally bypasses GUI and single-instance ownership. */
export function desktopMcpArgs(argv: string[]): string[] | null {
  const index = argv.indexOf("--studio-mcp");
  if (index < 0) return null;
  const args = argv.slice(index + 1);
  if (
    args.length === 0 ||
    args[0] !== "--project" ||
    !args[1] ||
    args[1].startsWith("--")
  )
    throw new Error("MCP_PROJECT_REQUIRED");
  if (args.length !== 2) throw new Error("MCP_INVALID_ARGUMENTS");
  return args;
}
