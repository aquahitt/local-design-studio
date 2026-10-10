import { it, expect } from "vitest";
import { batchSchema, projectSchema, validateComponentProps } from "./schema";
it("publishes recursive project and discriminated operation JSON schema", () => {
  expect(
    (projectSchema as any).$defs.node.properties.slots.additionalProperties
      .items.$ref,
  ).toBe("#/$defs/node");
  expect(
    (batchSchema as any).properties.operations.items.oneOf.map(
      (v: any) => v.properties.type.const,
    ),
  ).toContain("updateProps");
});
it("rejects invalid known component props while preserving unknown references", () => {
  const project: any = {
    library: { id: "x", version: "1" },
    pages: [
      { nodes: [{ id: "a", type: "Text", props: { text: 33 }, slots: {} }] },
    ],
  };
  const metadata: any = [
    {
      id: "x",
      version: "1",
      components: {
        Text: { fields: { text: { type: "string" } }, defaultProps: {} },
      },
    },
  ];
  expect(() => validateComponentProps(project, metadata)).toThrow(
    "INVALID_COMPONENT_PROP",
  );
  project.pages[0].nodes[0].type = "Future";
  expect(() => validateComponentProps(project, metadata)).not.toThrow();
});

it("validates token-bound field types, enums and ranges across themed values without rewriting refs", () => {
  const metadata: any = [
    {
      id: "x",
      version: "1",
      themes: [{ id: "light" }, { id: "dark" }],
      components: {
        Text: {
          fields: {
            text: { type: "string" },
            variant: { type: "select", options: ["primary", "secondary"] },
            size: { type: "number", min: 1, max: 10 },
          },
          defaultProps: {},
        },
      },
    },
  ];
  const project: any = {
    library: { id: "x", version: "1" },
    theme: "light",
    tokens: {
      n: { type: "number", value: 42 },
      v: { type: "string", value: "primary", themes: { dark: "invalid" } },
      size: { type: "number", value: 5, themes: { dark: 99 } },
    },
    pages: [
      {
        nodes: [
          {
            id: "a",
            type: "Text",
            props: { text: { $token: "n" } },
            slots: {},
          },
        ],
      },
    ],
  };
  expect(() => validateComponentProps(project, metadata)).toThrow(
    "INVALID_COMPONENT_PROP",
  );
  project.pages[0].nodes[0].props = { variant: { $token: "v" } };
  expect(() => validateComponentProps(project, metadata)).toThrow(
    "INVALID_COMPONENT_PROP",
  );
  project.pages[0].nodes[0].props = { size: { $token: "size" } };
  expect(() => validateComponentProps(project, metadata)).toThrow(
    "INVALID_COMPONENT_PROP",
  );
  project.tokens.v.themes.dark = "secondary";
  project.pages[0].nodes[0].props = { variant: { $token: "v" } };
  expect(() => validateComponentProps(project, metadata)).not.toThrow();
  expect(project.pages[0].nodes[0].props.variant).toEqual({ $token: "v" });
});
