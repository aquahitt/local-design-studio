import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, cpus, totalmem, platform, release, arch } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseProject,
  stableStringify,
  CoreError,
} from "../../src/core/project";
import { applyBatch } from "../../src/core/operations";
import { ProjectStore } from "../../src/core/store";
import { sceneLayers, hitTestScene, worldToScreen } from "../../src/core/scene";
import { readProjectPage } from "../../src/service/read";
import { Nodes } from "../../src/studio/Preview";
import { builtinLibrary } from "../../src/library/builtin";
import { createBenchmarkFixture } from "./fixture";
import {
  budgetFailures,
  type BenchmarkCase,
  type BudgetConfig,
} from "./budgets";

export type BenchmarkResult = BenchmarkCase & {
  samples: Record<string, number[]>;
  fixtureBytes: number;
};
export interface BenchmarkReport {
  formatVersion: 1;
  timestamp: string;
  hardware: {
    platform: string;
    release: string;
    arch: string;
    cpu: string;
    logicalCPUs: number;
    memoryMB: number;
    node: string;
    gcAvailable: boolean;
    browser?: string;
    userAgent?: string;
  };
  methodology: string;
  repetitions: number;
  cases: BenchmarkResult[];
  failures: string[];
}
function p95(samples: number[]) {
  const values = [...samples].sort((a, b) => a - b);
  return values[Math.ceil(values.length * 0.95) - 1];
}
export async function runCoreBenchmarks(
  counts = [1000, 10000, 50000],
  repetitions = 5,
): Promise<BenchmarkReport> {
  const report: BenchmarkReport = {
    formatVersion: 1,
    timestamp: new Date().toISOString(),
    hardware: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCPUs: cpus().length,
      memoryMB: totalmem() / 1024 ** 2,
      node: process.version,
      gcAvailable: typeof globalThis.gc === "function",
    },
    methodology:
      "One unreported warmup followed by five samples; p95 latency ceilings. Each sample creates/saves/reopens a real temporary ProjectStore. Transform is full flatten; hit testing averages 20 world queries; browser metrics use the actual Preview.Nodes renderer in a standalone interaction harness.",
    repetitions,
    cases: [],
    failures: [],
  };
  for (const count of counts) {
    globalThis.gc?.();
    const fixture = createBenchmarkFixture(count);
    const serialized = stableStringify(fixture);
    const fixtureBytes = Buffer.byteLength(serialized);
    const samples: Record<string, number[]> = {};
    let maxRss = process.memoryUsage().rss,
      maxHeap = process.memoryUsage().heapUsed;
    function memory() {
      const value = process.memoryUsage();
      maxRss = Math.max(maxRss, value.rss);
      maxHeap = Math.max(maxHeap, value.heapUsed);
    }
    async function time(
      name: string,
      measured: boolean,
      task: () => unknown | Promise<unknown>,
    ) {
      const start = performance.now();
      const result = await task();
      if (measured) (samples[name] ??= []).push(performance.now() - start);
      memory();
      return result;
    }
    let rejection: string | undefined;
    const start = performance.now();
    try {
      parseProject(fixture);
    } catch (error) {
      if (!(error instanceof CoreError)) throw error;
      rejection = error.code;
    }
    if (rejection) {
      memory();
      report.cases.push({
        count,
        status: "rejected",
        rejection,
        fixtureBytes,
        samples: {},
        metrics: {
          rejectionMs: performance.now() - start,
          rssMB: maxRss / 1024 ** 2,
          heapMB: maxHeap / 1024 ** 2,
          fixtureBytes,
        },
      });
      continue;
    }
    for (let repetition = -1; repetition < repetitions; repetition++) {
      globalThis.gc?.();
      const measured = repetition >= 0;
      const project = (await time("parseMs", measured, () =>
        parseProject(JSON.parse(serialized)),
      )) as ReturnType<typeof parseProject>;
      await time("canonicalMs", measured, () => stableStringify(project));
      await time("transformMs", measured, () => {
        const layers = sceneLayers(project.pages[0].nodes);
        for (const layer of layers)
          worldToScreen(
            { x: layer.transform[4], y: layer.transform[5] },
            { zoom: 1.25, panX: 10, panY: -20 },
          );
      });
      const hitStart = performance.now();
      for (let query = 0; query < 20; query++)
        hitTestScene(project.pages[0].nodes, {
          x: (query * 71) % 1200,
          y: query * 23,
        });
      if (measured)
        (samples.hitTestMs ??= []).push((performance.now() - hitStart) / 20);
      memory();
      await time("editBatchMs", measured, () =>
        applyBatch(project, {
          requestId: "benchmark-edit",
          baseRevision: project.revision,
          operations: [
            {
              type: "updateProps",
              nodeId: "layer-00000",
              props: { text: "Edited text" },
            },
          ],
        }),
      );
      let selectionBytes = 0,
        pageBytes = 0;
      await time("mcpSelectionMs", measured, () => {
        const selected = readProjectPage(
          project,
          { nodeId: `layer-${String(count - 1).padStart(5, "0")}`, limit: 1 },
          false,
        );
        selectionBytes = Buffer.byteLength(JSON.stringify(selected));
        pageBytes = Buffer.byteLength(
          JSON.stringify(readProjectPage(project, { limit: 20 }, false)),
        );
      });
      if (measured) {
        (samples.selectionBytes ??= []).push(selectionBytes);
        (samples.pageBytes ??= []).push(pageBytes);
      }
      await time("renderSsrMs", measured, () =>
        renderToStaticMarkup(
          createElement(Nodes, {
            nodes: project.pages[0].nodes,
            library: builtinLibrary,
            project,
            selected: null,
            onSelect: () => {},
          }),
        ),
      );
      const root = await mkdtemp(resolve(tmpdir(), "studio-benchmark-"));
      let store: ProjectStore | undefined;
      try {
        store = await ProjectStore.open(root, { initialProject: project });
        await time("saveMs", measured, () =>
          store!.apply({
            requestId: "save",
            baseRevision: project.revision,
            operations: [
              {
                type: "updateProps",
                nodeId: "layer-00000",
                props: { text: "Saved edit" },
              },
            ],
          }),
        );
        await store.close();
        store = undefined;
        store = (await time("loadMs", measured, () =>
          ProjectStore.open(root),
        )) as ProjectStore;
        if (
          store.read().revision !== 1 ||
          store.read().pages[0].nodes[0].props.text !== "Saved edit"
        )
          throw new Error("BENCHMARK_DATA_LOSS");
      } finally {
        await store?.close();
        await rm(root, { recursive: true, force: true });
      }
    }
    report.cases.push({
      count,
      status: "supported",
      fixtureBytes,
      samples,
      metrics: {
        ...Object.fromEntries(
          Object.entries(samples).map(([key, values]) => [key, p95(values)]),
        ),
        rssMB: maxRss / 1024 ** 2,
        heapMB: maxHeap / 1024 ** 2,
      },
    });
  }
  return report;
}
async function main() {
  const args = process.argv.slice(2);
  const browser = args.includes("--browser");
  const option = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1];
  };
  const output = resolve(option("--output", "benchmark-results.json"));
  const budgetPath = resolve(
    option(
      "--budgets",
      fileURLToPath(new URL("./budgets.json", import.meta.url)),
    ),
  );
  const report = await runCoreBenchmarks();
  let browserFailure: string | undefined;
  if (browser) {
    try {
      const { addBrowserBenchmarks } = await import("./browser");
      await addBrowserBenchmarks(report);
    } catch (error) {
      browserFailure = `BROWSER_BENCHMARK_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const config = JSON.parse(
    await readFile(budgetPath, "utf8"),
  ) as BudgetConfig & { browserCases?: BudgetConfig["cases"] };
  if (browser)
    for (const [count, limits] of Object.entries(config.browserCases ?? {}))
      config.cases[count] = { ...config.cases[count], ...limits };
  report.failures = budgetFailures(report.cases, config);
  if (browserFailure) report.failures.push(browserFailure);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  for (const result of report.cases)
    console.log(
      JSON.stringify({
        count: result.count,
        status: result.status,
        rejection: result.rejection,
        metrics: result.metrics,
      }),
    );
  console.log(`Benchmark report: ${output}`);
  if (report.failures.length) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
