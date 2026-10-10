import { it, expect } from "vitest";
import { DEVICE_PRESETS, presetViewport } from "./devicePresets";
import { contentViewport, parseViewport } from "../core/viewport";
it("all presets and rotations validate and report the actual orientation and usable area", () => {
  for (const preset of DEVICE_PRESETS)
    for (const rotated of [false, true]) {
      const viewport = parseViewport(presetViewport(preset, rotated));
      expect(viewport.device?.orientation).toBe(
        viewport.width > viewport.height! ? "landscape" : "portrait",
      );
      expect(contentViewport(viewport).width).toBeGreaterThanOrEqual(120);
      expect(contentViewport(viewport).height).toBeGreaterThanOrEqual(120);
    }
});
