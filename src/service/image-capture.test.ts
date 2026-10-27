import { expect, it } from "vitest";
import {
  assertImageResourcesReady,
  captureErrorReply,
  captureErrorFromReply,
} from "./capture";
import { CoreError } from "../core/project";

const asset = "assets/" + "a".repeat(64) + ".png";
it("rejects an unavailable rendered image before successful PNG metadata exists", () => {
  expect(() =>
    assertImageResourcesReady(
      [{ code: "PROJECT_IMAGE_UNAVAILABLE", asset }],
      [asset],
    ),
  ).toThrow("IMAGE_RESOURCE_UNAVAILABLE");
  expect(() => assertImageResourcesReady([], [asset])).not.toThrow();
});
it("native IPC preserves only the image error code and canonical asset diagnostics", () => {
  let error: unknown;
  try {
    assertImageResourcesReady(
      [{ code: "PROJECT_IMAGE_UNAVAILABLE", asset }],
      [asset],
    );
  } catch (caught) {
    error = caught;
  }
  const reply = JSON.parse(JSON.stringify(captureErrorReply(error)));
  const restored = captureErrorFromReply(reply);
  expect(restored).toBeInstanceOf(CoreError);
  expect(restored).toMatchObject({
    code: "IMAGE_RESOURCE_UNAVAILABLE",
    path: asset,
  });
  expect(restored.message).toContain(asset);
  expect(Object.keys(reply).sort()).toEqual([
    "error",
    "errorCode",
    "imageAssets",
  ]);
  const forged = captureErrorFromReply({
    error: "existing error",
    errorCode: "IMAGE_RESOURCE_UNAVAILABLE",
    imageAssets: ["https://secret.invalid/?token=private"],
  });
  expect(forged).not.toHaveProperty("code");
  expect(forged.message).toBe("existing error");
});
it("never echoes arbitrary warning text or unrelated resource paths", () => {
  for (const warnings of [
    [
      {
        code: "PROJECT_IMAGE_UNAVAILABLE",
        asset: "https://example.invalid/?secret=value",
      },
    ],
    { secret: "value" },
    [
      {
        code: "PROJECT_IMAGE_UNAVAILABLE",
        asset: "assets/" + "b".repeat(64) + ".png",
      },
    ],
  ]) {
    try {
      assertImageResourcesReady(warnings, [asset]);
      throw new Error("expected resource failure");
    } catch (error) {
      expect((error as Error).message).toBe("IMAGE_RESOURCE_UNAVAILABLE");
    }
  }
});
