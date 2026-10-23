import { expect, it } from "vitest";
import {
  canonicalCanvasBounds,
  measuredCanvasContext,
  canvasContextIdentity,
  createLatestPublisher,
} from "./canvasContext";
const context = {
  projectId: "project",
  pageId: "page",
  revision: 4,
  transient: false,
  view: { zoom: 2, panX: 10, panY: 20 },
  bounds: [{ id: "layer", x: 1, y: 2, width: 3, height: 4 }],
  width: 800,
  height: 600,
};
it("withholds pending, valid and invalid gesture measurements without losing camera", () => {
  const result = measuredCanvasContext({
    ...context,
    transient: true,
    epoch: 5,
    measuredEpoch: 5,
  });
  expect(result).toEqual({
    ...context,
    transient: true,
    bounds: [],
    revision: null,
  });
  // App must independently reject an accidentally unfiltered transient payload.
  expect(canonicalCanvasBounds({ ...context, transient: true }, 4)).toEqual([]);
});
it("clear-map cannot relabel old transient measurements as canonical before the replacement epoch", () => {
  const pending = measuredCanvasContext({
    ...context,
    epoch: 6,
    measuredEpoch: 5,
  });
  expect(pending.bounds).toEqual([]);
  expect(pending.revision).toBeNull();
  const ready = measuredCanvasContext({
    ...context,
    epoch: 6,
    measuredEpoch: 6,
  });
  expect(canonicalCanvasBounds(ready, 4)).toEqual(context.bounds);
  expect(canonicalCanvasBounds(ready, 5)).toEqual([]);
});

it("rejects measurements for a newly mounted page against an old send closure identity", () => {
  expect(canvasContextIdentity(context, "project", "page")).toBe(true);
  expect(canvasContextIdentity(context, "project", "old-page")).toBe(false);
  expect(canvasContextIdentity(context, "old-project", "page")).toBe(false);
});
it("serializes delayed canonical requests and coalesces intermediate updates to the latest status", async () => {
  const writes: string[] = [];
  let finish!: () => void;
  const publisher = createLatestPublisher(async (value: string) => {
    writes.push(value);
    if (value === "canonical")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  publisher.publish("canonical");
  publisher.publish("transient-initial");
  publisher.publish("transient-latest");
  expect(writes).toEqual(["canonical"]);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(writes).toEqual(["canonical", "transient-latest"]);
});
