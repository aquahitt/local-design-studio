import { it, expect } from "vitest";
import { mkdtemp, rm, readFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeSVGAsset, readSVGAsset } from "./assets";
it("writes content-addressed safe SVG assets durably and reads only safe names", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-assets-"));
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#eee"/><text x="20" y="30" fill="#222">Placeholder</text></svg>';
  try {
    const result = await writeSVGAsset(root, svg);
    expect(result.path).toMatch(/^assets\/[a-f0-9]{64}\.svg$/);
    expect(await readFile(join(root, result.path), "utf8")).toBe(svg);
    expect((await writeSVGAsset(root, svg)).path).toBe(result.path);
    expect((await readSVGAsset(root, result.path.slice(7))).toString()).toBe(
      svg,
    );
    await expect(readSVGAsset(root, "../secret")).rejects.toThrow(
      "INVALID_ASSET_NAME",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects active SVG, external references, entities, excess size and symlink assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-assets-")),
    outside = await mkdtemp(join(tmpdir(), "studio-outside-"));
  try {
    for (const svg of [
      "<svg><script>alert(1)</script></svg>",
      '<svg onload="alert(1)"></svg>',
      '<svg><image href="https://evil.test/x"/></svg>',
      "<svg><foreignObject/></svg>",
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg>&x;</svg>',
      '<svg><rect fill="url(https://evil.test)"/></svg>',
      "<svg><filter/></svg>",
    ])
      await expect(writeSVGAsset(root, svg)).rejects.toThrow("UNSAFE_SVG");
    await expect(writeSVGAsset(root, "x".repeat(262145))).rejects.toThrow(
      "ASSET_TOO_LARGE",
    );
    await symlink(outside, join(root, "assets"));
    await expect(writeSVGAsset(root, "<svg></svg>")).rejects.toThrow(
      "UNSAFE_SYMLINK",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
