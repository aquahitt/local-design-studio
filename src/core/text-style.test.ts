import { expect, it } from "vitest";
import { compileTextStyle } from "./text-style";
import { projectFontFamily, type ProjectFont } from "./fonts";
const font: ProjectFont = {
  id: "face",
  name: 'Display " ;url()',
  family: "User-facing only",
  assetHash: "b".repeat(64),
  format: "ttf",
  weight: 650,
  style: "italic",
};
const scene = { kind: "text" as const, x: 0, y: 0, width: 100, height: 20 };
it("preserves the legacy text layout exactly when no typography is set", () => {
  expect(compileTextStyle(scene, {})).toEqual({
    fontSize: 16,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    lineHeight: 1.4,
  });
});
it("compiles exact face descriptors and px line height without metadata CSS injection", () => {
  expect(
    compileTextStyle(
      {
        ...scene,
        fontSize: 20,
        textStyle: {
          fontId: "face",
          lineHeight: 28,
          letterSpacing: -0.5,
          align: "end",
          direction: "rtl",
        },
      },
      { fonts: [font] },
    ),
  ).toEqual({
    fontSize: 20,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    lineHeight: "28px",
    letterSpacing: -0.5,
    textAlign: "end",
    direction: "rtl",
    fontFamily: projectFontFamily(font),
    fontWeight: 650,
    fontStyle: "italic",
    fontSynthesis: "none",
  });
  expect(
    compileTextStyle({ ...scene, textStyle: { direction: "auto" } }, {}),
  ).toMatchObject({ unicodeBidi: "plaintext" });
});
