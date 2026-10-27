import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "./server";
import { PAINT_CAPABILITIES } from "./read";
it("publishes portable image paint units and limits through the real capabilities endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "image-capabilities-"));
  const owner = await createStudioServer({ root, port: 0 });
  try {
    const response = await fetch(owner.url + "/api/capabilities", {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.paints).toEqual(PAINT_CAPABILITIES);
    expect(data.paints.image).toMatchObject({
      modes: ["cover", "contain", "crop", "tile"],
      matrixUnits: "UV-to-frame-css-pixels",
      anchorUnits: "normalized",
    });
  } finally {
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
