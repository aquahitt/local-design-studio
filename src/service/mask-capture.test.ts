import { expect, it } from "vitest";
import { CoreError } from "../core/project";
import { assertMaskResourcesReady } from "./mask-capture";
import { captureErrorReply, captureErrorFromReply } from "./capture";
it("only canonical scoped mask failures become typed snapshot errors without leaking details", () => {
  for (const code of [
    "MASK_SOURCE_UNSUPPORTED",
    "MASK_SOURCE_LIMIT",
    "MASK_IMAGE_UNAVAILABLE",
    "MASK_RENDER_UNAVAILABLE",
  ]) {
    expect(() =>
      assertMaskResourcesReady(
        [{ maskId: "mask", code, nodeId: "source", feature: "primitive-kind" }],
        ["mask"],
        ["mask", "source"],
      ),
    ).toThrow(code);
    const reply = captureErrorReply(
      new CoreError(code, "private resource/CSS must not escape"),
    );
    expect(reply).toEqual({ error: code, errorCode: code });
    expect(captureErrorFromReply(reply)).toMatchObject({ code });
  }
  expect(() => assertMaskResourcesReady([], [], [])).not.toThrow();
  for (const warning of [
    {
      maskId: "foreign",
      code: "MASK_SOURCE_UNSUPPORTED",
      feature: "primitive-kind",
    },
    {
      maskId: "mask",
      code: "MASK_SOURCE_UNSUPPORTED",
      nodeId: "foreign",
      feature: "primitive-kind",
    },
    { maskId: "mask", code: "https://private", feature: "private value" },
  ])
    expect(() =>
      assertMaskResourcesReady([warning], ["mask"], ["mask", "source"]),
    ).toThrow("MASK_RENDER_UNAVAILABLE");
});
