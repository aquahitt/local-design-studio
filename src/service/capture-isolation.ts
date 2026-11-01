export type CaptureIsolationInput = {
  nodeId: string;
  nodeIds?: readonly string[];
};
export type CaptureIsolationResult = {
  boundsBefore: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  diagnostics: { code: string; nodeId?: string; feature?: string }[];
};

/** Closed browser factory; runs only in a disposable snapshot, never the editor. */
export async function isolateCaptureDOM(
  input: CaptureIsolationInput,
): Promise<CaptureIsolationResult> {
  const diagnostics: CaptureIsolationResult["diagnostics"] = [];
  const { unsupported } = {
    unsupported(feature: string, nodeId?: string) {
      diagnostics.push({
        code: "ISOLATED_CAPTURE_UNSUPPORTED",
        ...(nodeId ? { nodeId } : {}),
        feature,
      });
    },
  };
  const { rectangle } = {
    rectangle(element: Element, id: string) {
      const box = element.getBoundingClientRect();
      return { id, x: box.x, y: box.y, width: box.width, height: box.height };
    },
  };
  const elements = [...document.body.querySelectorAll("*")];
  if (elements.length > 200000) {
    unsupported("dom-limit");
    return { boundsBefore: [], diagnostics };
  }
  const allowed = input.nodeIds
    ? new Set([...input.nodeIds, input.nodeId])
    : null;
  const roots = [...document.querySelectorAll("[data-node-id]")].filter(
    (element) => !allowed || allowed.has(element.getAttribute("data-node-id")!),
  );
  const byId = new Map<string, Element>();
  for (const element of roots) {
    const id = element.getAttribute("data-node-id")!;
    if (byId.has(id)) {
      unsupported("ambiguous-node", id);
      return { boundsBefore: [], diagnostics };
    }
    byId.set(id, element);
  }
  const boundsBefore = roots.map((element) =>
    rectangle(element, element.getAttribute("data-node-id")!),
  );
  const target = byId.get(input.nodeId);
  if (!target) {
    unsupported("node-not-found", input.nodeId);
    return { boundsBefore, diagnostics };
  }
  const ancestors: Element[] = [];
  for (
    let element = target.parentElement;
    element;
    element = element.parentElement
  )
    ancestors.push(element);
  for (const ancestor of ancestors) {
    const style = getComputedStyle(ancestor);
    if (style.filter !== "none") {
      unsupported("filter");
      break;
    }
    if (
      ["backdrop-filter", "-webkit-backdrop-filter"].some((property) => {
        const value = style.getPropertyValue(property);
        return value && value !== "none";
      })
    ) {
      unsupported("backdrop-filter");
      break;
    }
    if (style.mixBlendMode && style.mixBlendMode !== "normal") {
      unsupported("mix-blend-mode");
      break;
    }
  }
  const root = document.getElementById("root");
  for (const element of [...document.body.children]) {
    if (
      element === root ||
      element.contains(target) ||
      ["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT"].includes(
        element.tagName,
      )
    )
      continue;
    const style = getComputedStyle(element),
      box = element.getBoundingClientRect();
    if (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      box.width > 0 &&
      box.height > 0
    ) {
      unsupported("portal");
      break;
    }
  }
  if (diagnostics.length) return { boundsBefore, diagnostics };
  // CSS pseudo-elements can explicitly override inherited visibility. Reject
  // such external paint before mutation rather than leak it into an isolated PNG.
  for (const element of [
    document.documentElement,
    document.body,
    ...elements,
  ]) {
    if (element === target || target.contains(element)) continue;
    let painted = true;
    for (
      let ancestor: Element | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || Number(style.opacity) === 0) {
        painted = false;
        break;
      }
    }
    if (!painted) continue;
    for (const pseudo of ["::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      if (
        style.content &&
        style.content !== "none" &&
        style.content !== "normal" &&
        style.display !== "none" &&
        style.visibility === "visible" &&
        Number(style.opacity) !== 0
      ) {
        unsupported("outside-pseudo-element");
        return { boundsBefore, diagnostics };
      }
    }
  }

  const kept = [target, ...target.querySelectorAll("*")];
  const originalVisibility = new Map(
    kept.map((element) => [element, getComputedStyle(element).visibility]),
  );
  const keptRects = roots
    .filter((element) => element === target || target.contains(element))
    .map((element) => ({
      element,
      bounds: rectangle(element, element.getAttribute("data-node-id")!),
    }));
  const { set } = {
    set(element: Element, property: string, value: string) {
      const style = (element as HTMLElement).style;
      if (style?.setProperty) style.setProperty(property, value, "important");
    },
  };
  // Keep sibling/ancestor boxes intact for flow, selectors and containing blocks.
  for (const element of [
    document.documentElement,
    document.body,
    ...elements,
  ]) {
    set(element, "visibility", originalVisibility.get(element) ?? "hidden");
  }
  for (const ancestor of ancestors) {
    const contain = getComputedStyle(ancestor).contain;
    for (const property of [
      "background-color",
      "border-color",
      "outline-color",
    ])
      set(ancestor, property, "transparent");
    for (const property of ["background-image", "box-shadow", "outline-style"])
      set(ancestor, property, "none");
    set(ancestor, "overflow-x", "visible");
    set(ancestor, "overflow-y", "visible");
    set(ancestor, "clip-path", "none");
    set(ancestor, "clip", "auto");
    set(ancestor, "mask", "none");
    set(ancestor, "mask-image", "none");
    set(ancestor, "-webkit-mask-image", "none");
    if (contain === "strict") set(ancestor, "contain", "size layout style");
    else if (contain === "content") set(ancestor, "contain", "layout style");
    else if (contain.split(/\s+/).includes("paint"))
      set(
        ancestor,
        "contain",
        contain
          .split(/\s+/)
          .filter((token) => token !== "paint")
          .join(" ") || "none",
      );
  }
  for (const element of [document.documentElement, document.body]) {
    set(element, "background-color", "transparent");
    set(element, "background-image", "none");
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  for (const { element, bounds } of keptRects) {
    const after = rectangle(element, bounds.id);
    if (
      ["x", "y", "width", "height"].some(
        (key) => Math.abs(after[key as "x"] - bounds[key as "x"]) > 0.02,
      )
    ) {
      unsupported("layout-shift", bounds.id);
      break;
    }
  }
  return { boundsBefore, diagnostics };
}

export function isolateCaptureExpression(input: CaptureIsolationInput): string {
  return `(${isolateCaptureDOM.toString()})(${JSON.stringify(input)})`;
}
