import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDefaults } from "../library/localCatalog";
import { CoreError, parseProject, type JSONRecord } from "./project";
import { ProjectStore } from "./store";

const fixtureNames = [
  "SegmentedControl",
  "ChipRadioRow",
  "RadioChips",
  "FeatureCheckboxes",
  "AttributeFields",
];

function project(props: JSONRecord = {}) {
  return {
    schemaVersion: 2,
    projectId: "p",
    name: "Validation",
    revision: 0,
    pages: [
      {
        screenId: "home",
        name: "Home",
        viewport: { width: 800 },
        nodes: [{ id: "control", type: "SegmentedControl", props, slots: {} }],
      },
    ],
    library: { id: "external", version: "1" },
    theme: "light",
    tokens: {},
  };
}

function expectFailure(input: unknown, code: string, path: string) {
  let error: unknown;
  try {
    parseProject(input);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(CoreError);
  expect(error).toMatchObject({ code, path, message: `${code}: ${path}` });
}

it.each(fixtureNames)(
  "accepts ordinary nested code data in the %s fixture",
  (name) => {
    const props = localDefaults[name] as JSONRecord;
    expect(parseProject(project(props)).pages[0].nodes[0].props).toEqual(props);
  },
);

it.each(["onClick", "dangerouslySetInnerHTML", "script", "html", "code"])(
  "rejects executable top-level %s props with the complete path",
  (key) => {
    expectFailure(
      project({ [key]: "alert(1)" }),
      "EXECUTABLE_FIELD",
      `pages[0].nodes[0].props.${key}`,
    );
  },
);

it.each(["__proto__", "prototype", "constructor"])(
  "rejects nested %s pollution keys with array indexes",
  (key) => {
    const unsafe = JSON.parse(`{"${key}":"unsafe"}`);
    expectFailure(
      project({ options: [{ code: "safe" }, unsafe] }),
      "EXECUTABLE_FIELD",
      `pages[0].nodes[0].props.options[1].${key}`,
    );
  },
);

it("rejects pollution keys outside node props", () => {
  expectFailure(
    { ...project(), tokens: JSON.parse('{"constructor":{}}') },
    "EXECUTABLE_FIELD",
    "tokens.constructor",
  );
});

it("reports paths through nested slots and option arrays", () => {
  const input = project();
  input.pages[0].nodes[0].slots = {
    content: [
      {
        id: "child",
        type: "Control",
        props: { options: [{ code: "safe", onClick: "alert(1)" }] },
        slots: {},
      },
    ],
  };
  expectFailure(
    input,
    "EXECUTABLE_FIELD",
    "pages[0].nodes[0].slots.content[0].props.options[0].onClick",
  );
});

it.each([
  [
    { options: [{ url: "javascript:alert(1)" }] },
    "UNSAFE_URL",
    "options[0].url",
  ],
  [
    { options: [{ src: "../secret.svg" }] },
    "UNSAFE_ASSET_REFERENCE",
    "options[0].src",
  ],
  [
    { options: [{ label: { $token: "missing" } }] },
    "MISSING_TOKEN",
    "options[0].label",
  ],
] as [JSONRecord, string, string][])(
  "reports the full path for unsafe JSON values",
  (props, code, suffix) => {
    expectFailure(project(props), code, `pages[0].nodes[0].props.${suffix}`);
  },
);

const roots: string[] = [];
const stores: ProjectStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.each(fixtureNames)(
  "saves and reopens %s fixture data with nested code keys",
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), "studio-validation-"));
    roots.push(root);
    const store = await ProjectStore.open(root, {
      initialProject: parseProject(project()),
    });
    stores.push(store);
    const props = localDefaults[name] as JSONRecord;
    await store.apply({
      requestId: "fixture",
      baseRevision: 0,
      operations: [{ type: "updateProps", nodeId: "control", props }],
    });
    await store.close();
    const reopened = await ProjectStore.open(root);
    stores.push(reopened);
    expect(reopened.read().pages[0].nodes[0].props).toEqual(props);
    expect(reopened.read().revision).toBe(1);
  },
);
