import { expect, it } from "vitest";
import { parseProject } from "./project";
import { readProjectPage } from "../service/read";
import * as fixtures from "../../scripts/benchmarks/fixture";
import type { BenchmarkReport } from "../../scripts/benchmarks/run";
import * as budgets from "../../scripts/benchmarks/budgets";

it("reads bounded selection pages from a deterministic 10k scene without returning tokens", () => {
  const fixture = fixtures.createBenchmarkFixture(10000);
  expect(fixture).toEqual(fixtures.createBenchmarkFixture(10000));
  const project = parseProject(fixture);
  const selected = readProjectPage(
    project,
    { nodeId: "layer-09999", limit: 1 },
    false,
  );
  expect(selected.nodes).toHaveLength(1);
  expect(selected.nodes[0].id).toBe("layer-09999");
  expect(selected).not.toHaveProperty("tokens");
  expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThan(2500);
  const page = readProjectPage(project, { limit: 20 }, false);
  expect(page.nodes).toHaveLength(20);
  expect(page.pagination).toMatchObject({ total: 10000, nextOffset: 20 });
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(25000);
});

it("rejects the 50k fixture at a real project limit rather than silently truncating layers", () => {
  const input = fixtures.createBenchmarkFixture(50000);
  expect(input.pages[0].nodes).toHaveLength(50000);
  expect(() => parseProject(input)).toThrow(/MAX_NODES|PROJECT_TOO_LARGE/);
  expect(input.pages[0].nodes).toHaveLength(50000);
});

it("fails benchmark validation on latency, memory, response-size and unexpected support regressions", () => {
  const limits = {
    cases: { "1000": { parseMs: 200, rssMB: 512, selectionBytes: 2500 } },
    expectedRejections: { "50000": ["PROJECT_TOO_LARGE", "MAX_NODES"] },
  };
  const baseline: BenchmarkReport["cases"] = [
    {
      count: 1000,
      status: "supported",
      samples: {},
      fixtureBytes: 0,
      metrics: { parseMs: 100, rssMB: 300, selectionBytes: 1000 },
    },
    {
      count: 50000,
      status: "rejected",
      samples: {},
      fixtureBytes: 0,
      rejection: "MAX_NODES",
      metrics: {},
    },
  ];
  expect(budgets.budgetFailures(baseline, limits)).toEqual([]);
  for (const [key, value] of [
    ["parseMs", 201],
    ["rssMB", 513],
    ["selectionBytes", 2501],
  ]) {
    const results = structuredClone(baseline);
    results[0].metrics[String(key)] = Number(value);
    expect(budgets.budgetFailures(results, limits)).toContain(
      `1000.${key}: ${value} > ${limits.cases["1000"][key as keyof (typeof limits.cases)["1000"]]}`,
    );
  }
  expect(
    budgets.budgetFailures(
      [{ count: 50000, status: "supported", metrics: {} }],
      limits,
    ),
  ).toContain("50000: expected limit rejection");
  expect(
    budgets.budgetFailures(
      [{ count: 1000, status: "supported", metrics: {} }],
      limits,
    ),
  ).toContain("1000.parseMs: missing or non-finite metric");
});

it("does not weaken executable-prop validation at the supported 10k boundary", () => {
  const project = fixtures.createBenchmarkFixture(10000);
  project.pages[0].nodes[9999].props.onClick = "alert(1)";
  expect(() => parseProject(project)).toThrow(
    "EXECUTABLE_FIELD: pages[0].nodes[9999].props.onClick",
  );
});
