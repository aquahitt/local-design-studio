import { fileURLToPath } from "node:url";
import type { BenchmarkReport } from "./run";
import type { SceneBenchmarkBridge } from "./preview-entry";
import { createBenchmarkFixture } from "./fixture";

/** Uses the production Preview.Nodes component; this harness isolates renderer/engine latency. */
export async function addBrowserBenchmarks(
  report: BenchmarkReport,
): Promise<void> {
  const [{ build }, { chromium }] = await Promise.all([
    import("esbuild"),
    import("@playwright/test"),
  ]);
  const buildResult = await build({
    entryPoints: [
      fileURLToPath(new URL("./preview-entry.tsx", import.meta.url)),
    ],
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    write: false,
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.BASE_URL": '"/"',
      "import.meta.url": '"about:blank"',
    },
  });
  const browser = await chromium.launch({ headless: true });
  report.hardware.browser = `Chromium ${browser.version()}`;
  try {
    for (const result of report.cases) {
      if (result.status !== "supported") continue;
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => route.abort());
      await page.setContent(
        '<!doctype html><html lang="en"><body style="margin:0"><div id="root"></div></body></html>',
      );
      await page.addScriptTag({ content: buildResult.outputFiles[0].text });
      report.hardware.userAgent = await page.evaluate(
        () => navigator.userAgent,
      );
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      let maxHeap = 0;
      const fixture = createBenchmarkFixture(result.count);
      for (let repetition = -1; repetition < report.repetitions; repetition++) {
        const render = await page.evaluate(
          (serialized) =>
            (window.sceneBenchmark as SceneBenchmarkBridge).load(
              JSON.parse(serialized),
            ),
          JSON.stringify(fixture),
        );
        if ((await page.locator("[data-node-id]").count()) !== result.count)
          throw new Error("BENCHMARK_RENDER_TRUNCATED");
        const panZoom = await page.evaluate(() =>
          window.sceneBenchmark.panZoom(),
        );
        const drag = await page.evaluate(() => window.sceneBenchmark.drag());
        await page.locator("#benchmark-text").fill(`Input ${repetition}`);
        const textInput = await page.evaluate(() =>
          window.sceneBenchmark.waitForText(),
        );
        if ((await page.evaluate(() => window.sceneBenchmark.revision())) !== 2)
          throw new Error("BENCHMARK_BROWSER_DATA_LOSS");
        if (repetition >= 0) {
          for (const [key, value] of Object.entries({
            browserRenderMs: render,
            browserPanZoomMs: panZoom,
            browserDragMs: drag,
            browserTextInputMs: textInput,
          }))
            (result.samples[key] ??= []).push(value);
        }
        const { metrics } = await cdp.send("Performance.getMetrics");
        maxHeap = Math.max(
          maxHeap,
          metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ??
            0,
        );
      }
      if (errors.length)
        throw new Error(`BENCHMARK_BROWSER_ERROR: ${errors.join("; ")}`);
      for (const name of [
        "browserRenderMs",
        "browserPanZoomMs",
        "browserDragMs",
        "browserTextInputMs",
      ]) {
        const samples = [...result.samples[name]].sort((a, b) => a - b);
        result.metrics[name] = samples[Math.ceil(samples.length * 0.95) - 1];
      }
      result.metrics.browserHeapMB = maxHeap / 1024 ** 2;
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
