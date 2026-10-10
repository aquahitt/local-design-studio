import type { Project, ProjectNode } from "../../src/core/project";

/** Stable source IDs and varied declarative primitives; no clocks, randomness or network assets. */
export function createBenchmarkFixture(count: number): Project {
  if (!Number.isSafeInteger(count) || count < 1 || count > 50_000)
    throw new Error("INVALID_BENCHMARK_SIZE");
  return {
    schemaVersion: 2,
    projectId: `benchmark-${count}`,
    name: `${count} scene layers`,
    revision: 0,
    library: { id: "builtin", version: "1" },
    theme: "light",
    tokens: {},
    pages: [
      {
        screenId: "benchmark",
        name: "Benchmark",
        viewport: { width: 1280, height: 900 },
        nodes: Array.from({ length: count }, (_, index): ProjectNode => {
          const kind =
            index % 3 === 0 ? "text" : index % 3 === 1 ? "frame" : "vector";
          return {
            id: `layer-${String(index).padStart(5, "0")}`,
            type:
              kind === "text"
                ? "SceneText"
                : kind === "frame"
                  ? "SceneFrame"
                  : "SceneVector",
            props: kind === "text" ? { text: `Layer ${index}` } : {},
            slots: {},
            scene: {
              kind,
              x: (index % 50) * 24,
              y: Math.floor(index / 50) * 24,
              width: 22,
              height: 22,
              fill: "#64748b",
              ...(kind === "text" ? { fontSize: 12 } : {}),
              ...(kind === "vector" ? { path: "M0 0 L22 0 L11 22 Z" } : {}),
            },
          };
        }),
      },
    ],
  };
}
