import { describe, expect, it } from "vitest";
import type { Project, ProjectNode } from "../core/project";
import { parseProject } from "../core/project";
import { sceneProject } from "../core/scene-fixtures";
import type { Operation } from "../core/operations";
import {
  geometryResult,
  withTransientGeometry,
  validCanvasRender,
} from "./transientGeometry";
const node: ProjectNode = {
  id: "layer",
  type: "Text",
  props: { text: "Alpha Beta" },
  slots: {},
  scene: {
    kind: "text",
    x: 10,
    y: 20,
    width: 120,
    height: 50,
    rotation: 30,
    fontSize: 16,
    fill: "red",
  },
};
const project: Project = {
  schemaVersion: 2,
  projectId: "test",
  name: "Test",
  revision: 3,
  library: { id: "builtin", version: "1" },
  theme: "light",
  tokens: {},
  pages: [
    {
      screenId: "page",
      name: "Page",
      viewport: { width: 390, height: 600 },
      nodes: [node, { ...node, id: "other" }],
    },
  ],
};
const geometry = {
  x: 15,
  y: 25,
  width: 80,
  height: 40,
  linearTransform: [1, 0.5, 0, 2] as [number, number, number, number],
};
const op: Operation = { type: "setNodeGeometry", nodeId: "layer", geometry };
const result = (operations: readonly Operation[] = [op]) =>
  geometryResult(operations, project, "page", ["layer"]);
it("replaces all geometry, removes the alternative transform, preserves content and leaves inputs untouched", () => {
  const before = JSON.stringify(project),
    output = result();
  const effective = withTransientGeometry(node, output.geometry);
  expect(effective.scene).toEqual({
    kind: "text",
    fontSize: 16,
    fill: "red",
    ...geometry,
  });
  expect(effective.props).toBe(node.props);
  expect(effective.slots).toBe(node.slots);
  expect(effective.scene!.rotation).toBeUndefined();
  expect(JSON.stringify(project)).toBe(before);
  expect(output.operations).toEqual([op]);
  expect(output.operations[0]).not.toBe(op);
  output.geometry.layer.linearTransform![0] = 2;
  expect(geometry.linearTransform[0]).toBe(1);
  const rotated = withTransientGeometry(
    effective,
    result([
      {
        type: "setNodeGeometry",
        nodeId: "layer",
        geometry: { x: 1, y: 2, width: 3, height: 4, rotation: 45 },
      },
    ]).geometry,
  );
  expect(rotated.scene!.linearTransform).toBeUndefined();
  expect(rotated.scene!.rotation).toBe(45);
  expect(withTransientGeometry(node, {})).toBe(node);
  expect(result([])).toEqual({ operations: [], geometry: {} });
});
describe("whole-result rejection", () => {
  const bad = [
    { ...geometry, path: "M0 0" },
    { ...geometry, rotation: 10 },
    { x: 1, y: 2 },
    { ...geometry, width: 0 },
    { ...geometry, x: Infinity },
    { ...geometry, linearTransform: [1, 0, 0, 0] },
    Object.assign(Object.create({ x: 1 }), { y: 2, width: 3, height: 4 }),
    JSON.parse(
      '{"x":1,"y":2,"width":3,"height":4,"__proto__":{"polluted":true}}',
    ),
  ];
  it.each(bad)("rejects invalid geometry atomically %#", (badGeometry) => {
    const before = JSON.stringify(project);
    expect(() =>
      result([
        op,
        {
          type: "setNodeGeometry",
          nodeId: "layer",
          geometry: badGeometry,
        } as Operation,
      ]),
    ).toThrow();
    expect(() =>
      result([
        {
          type: "setNodeGeometry",
          nodeId: "layer",
          geometry: badGeometry,
        } as Operation,
      ]),
    ).toThrow();
    expect(JSON.stringify(project)).toBe(before);
    expect(({} as any).polluted).toBeUndefined();
  });
  it("rejects duplicates, wrong operation, foreign-page/root/virtual IDs and inherited map access", () => {
    expect(() => result([op, op])).toThrow();
    expect(() =>
      result([
        { type: "updateProps", nodeId: "layer", props: { text: "Oops" } },
      ]),
    ).toThrow();
    for (const id of [
      "unknown",
      "other",
      "layer::definition",
      "__proto__",
      "constructor",
    ])
      expect(() => result([{ ...op, nodeId: id }])).toThrow();
    expect(() => geometryResult([op], project, "missing", ["layer"])).toThrow();
    expect(() =>
      withTransientGeometry(node, Object.create({ layer: geometry })),
    ).toThrow();
  });
});
it("only lets canonical instance wrappers receive geometry, never materialized definition children", () => {
  const instance = {
    ...node,
    id: "instance",
    instance: { definitionId: "definition" },
  };
  const p = { ...project, pages: [{ ...project.pages[0], nodes: [instance] }] };
  expect(
    geometryResult([{ ...op, nodeId: "instance" }], p, "page", ["instance"])
      .geometry.instance,
  ).toEqual(geometry);
  expect(() =>
    geometryResult([{ ...op, nodeId: "instance::child" }], p, "page", [
      "instance",
    ]),
  ).toThrow();
});
const envelope = () => ({
  surfaceId: "surface",
  epoch: 3,
  view: { zoom: 1, panX: 0, panY: 0 },
  geometry: { layer: geometry },
});
it.each(["constructor", "prototype", "__proto__"])(
  "preserves canonical reserved-label ID %s across cloning and transient rendering",
  (id) => {
    const raw = sceneProject();
    raw.pages[0].nodes[0].id = id;
    const p = parseProject(raw);
    const nodes = p.pages[0].nodes;
    const canvas = { ...envelope(), geometry: {} };
    expect(validCanvasRender(canvas, p, nodes)).toBe(true);
    const output = geometryResult(
      [{ type: "setNodeGeometry", nodeId: id, geometry }],
      p,
      p.pages[0].screenId,
      [id],
    );
    expect(Object.getPrototypeOf(output.geometry)).toBeNull();
    expect(Object.hasOwn(output.geometry, id)).toBe(true);
    const cloned = structuredClone(output.geometry);
    expect(validCanvasRender({ ...canvas, geometry: cloned }, p, nodes)).toBe(
      true,
    );
    const rendered = withTransientGeometry(nodes[0], cloned);
    expect(rendered.scene).toMatchObject(geometry);
    expect(rendered.scene!.rotation).toBeUndefined();
    expect(nodes[0].scene).not.toMatchObject(geometry);
    expect(withTransientGeometry(nodes[0], {})).toBe(nodes[0]);
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const unsafe = JSON.parse(
        JSON.stringify({ ...geometry, [key]: { polluted: true } }),
      );
      expect(() =>
        geometryResult(
          [{ type: "setNodeGeometry", nodeId: id, geometry: unsafe }],
          p,
          p.pages[0].screenId,
          [id],
        ),
      ).toThrow("INVALID_TRANSIENT_GEOMETRY");
    }
    const accessor = Object.defineProperty({}, id, {
      enumerable: true,
      get() {
        throw new Error("accessor ran");
      },
    });
    expect(validCanvasRender({ ...canvas, geometry: accessor }, p, nodes)).toBe(
      false,
    );
    expect(() => withTransientGeometry(nodes[0], accessor)).toThrow(
      "INVALID_TRANSIENT_GEOMETRY",
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  },
);
it("validates the full canvas envelope and rejects any unknown, nonfinite or partial override", () => {
  expect(validCanvasRender(envelope(), project, project.pages[0].nodes)).toBe(
    true,
  );
  expect(
    validCanvasRender(
      { ...envelope(), geometry: {} },
      project,
      project.pages[0].nodes,
    ),
  ).toBe(true);
  for (const bad of [
    { ...envelope(), positions: {} },
    { ...envelope(), epoch: -1 },
    { ...envelope(), epoch: 1.5 },
    { ...envelope(), surfaceId: "" },
    { ...envelope(), view: { zoom: 0, panX: 0, panY: 0 } },
    { ...envelope(), view: { zoom: 1, panX: NaN, panY: 0 } },
    { ...envelope(), view: { zoom: 1, panX: 0, panY: 0, width: 2 } },
    { ...envelope(), geometry: { layer: { x: 1, y: 2 } } },
    { ...envelope(), geometry: { unknown: geometry } },
    { ...envelope(), geometry: Object.create({ layer: geometry }) },
  ])
    expect(validCanvasRender(bad, project, project.pages[0].nodes)).toBe(false);
  expect(
    validCanvasRender(
      envelope(),
      { ...project, revision: NaN },
      project.pages[0].nodes,
    ),
  ).toBe(false);
  expect(
    validCanvasRender(envelope(), project, [
      { ...node, id: "layer::generated" },
    ]),
  ).toBe(false);
});
