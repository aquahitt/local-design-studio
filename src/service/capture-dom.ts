import type { RenderBounds } from "./render";
export type CaptureDiagnostic = {
  code: string;
  nodeId?: string;
  feature: string;
};
export type CaptureMeasurement = {
  bounds: RenderBounds[];
  visualBounds: RenderBounds[];
  diagnostics: CaptureDiagnostic[];
  warnings: string[];
  policy: string;
};
export type CaptureMeasurementInput = {
  nodeId?: string;
  nodeIds?: readonly string[];
  visual?: boolean;
};
/** Closed browser factory. Coordinates come from painted DOM, never a model-only offset. */
export function measureCaptureDOM(
  input: CaptureMeasurementInput,
): CaptureMeasurement {
  type Rect = { x: number; y: number; width: number; height: number };
  type Linear = [number, number, number, number];
  const diagnostics: CaptureDiagnostic[] = [],
    warnings: string[] = [],
    seen = new Set<string>();
  const policy = "dom-paint-envelope-v1/css-raster-envelope-6sigma-plus-2px";
  const { diagnostic } = {
    diagnostic(feature: string, nodeId?: string) {
      const key = JSON.stringify([feature, nodeId]);
      if (!seen.has(key) && diagnostics.length < 100) {
        seen.add(key);
        diagnostics.push({
          code: "VISUAL_BOUNDS_UNSUPPORTED",
          ...(nodeId ? { nodeId } : {}),
          feature,
        });
      }
    },
  };
  const { box } = {
    box(element: Element): Rect {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
  };
  const { valid } = {
    valid(r: Rect) {
      return (
        [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
        r.width > 0 &&
        r.height > 0
      );
    },
  };
  const { union } = {
    union(a: Rect, b: Rect): Rect {
      const x = Math.min(a.x, b.x),
        y = Math.min(a.y, b.y);
      return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
      };
    },
  };
  const { intersection } = {
    intersection(a: Rect, b: Rect): Rect {
      const x = Math.max(a.x, b.x),
        y = Math.max(a.y, b.y);
      return {
        x,
        y,
        width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
        height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
      };
    },
  };
  const styles = new WeakMap<Element, CSSStyleDeclaration>();
  const { css } = {
    css(element: Element) {
      let value = styles.get(element);
      if (!value) {
        value = getComputedStyle(element);
        styles.set(element, value);
      }
      return value;
    },
  };
  const { visible } = {
    visible(element: Element) {
      if (["hidden", "collapse"].includes(css(element).visibility))
        return false;
      for (
        let current: Element | null = element;
        current;
        current = current.parentElement
      ) {
        const s = css(current);
        if (s.display === "none" || Number(s.opacity) === 0) return false;
      }
      return true;
    },
  };
  const all = [...document.querySelectorAll("[data-node-id]")];
  const allowed = input.nodeIds ? new Set(input.nodeIds) : null;
  const roots = all.filter(
    (element) => !allowed || allowed.has(element.getAttribute("data-node-id")!),
  );
  const byId = new Map<string, Element>();
  for (const element of roots) {
    const id = element.getAttribute("data-node-id")!;
    if (byId.has(id)) diagnostic("ambiguous-node", id);
    else byId.set(id, element);
  }
  const bounds = roots.map((element) => ({
    id: element.getAttribute("data-node-id")!,
    ...box(element),
  }));
  if (!input.visual || !input.nodeId)
    return { bounds, visualBounds: [], diagnostics, warnings, policy };
  const root = byId.get(input.nodeId);
  if (!root) {
    diagnostic("node-not-found", input.nodeId);
    return { bounds, visualBounds: [], diagnostics, warnings, policy };
  }
  for (
    let ancestor = root.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = css(ancestor);
    if (style.filter && style.filter !== "none")
      diagnostic("ancestor-filter", input.nodeId);
    if (
      ["backdrop-filter", "-webkit-backdrop-filter"].some((property) => {
        const value = style.getPropertyValue(property);
        return value && value !== "none";
      })
    )
      diagnostic("ancestor-backdrop-filter", input.nodeId);
  }
  const elements = [root, ...root.querySelectorAll("*")];
  if (elements.length > 200000) {
    diagnostic("dom-limit", input.nodeId);
    return { bounds, visualBounds: [], diagnostics, warnings, policy };
  }
  const matrices = new WeakMap<Element, Linear>();
  const { multiply } = {
    multiply(a: Linear, b: Linear): Linear {
      return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
      ];
    },
  };
  const { matrix } = {
    matrix(element: Element): Linear {
      const cached = matrices.get(element);
      if (cached) return cached;
      const style = css(element);
      let local: Linear = [1, 0, 0, 1];
      if (
        (style.perspective && style.perspective !== "none") ||
        (style.getPropertyValue("offset-path") &&
          style.getPropertyValue("offset-path") !== "none")
      )
        diagnostic("non-affine-transform", input.nodeId);
      try {
        const transform = new DOMMatrixReadOnly(
          style.transform === "none" ? undefined : style.transform,
        );
        if (!transform.is2D) diagnostic("non-affine-transform", input.nodeId);
        local = [transform.a, transform.b, transform.c, transform.d];
      } catch {
        diagnostic("non-affine-transform", input.nodeId);
      }
      let individualRotate: Linear | undefined;
      const rotate = style.getPropertyValue("rotate");
      if (rotate && rotate !== "none") {
        const match = /^(?:z\s+)?([+-]?[\d.]+)(deg|rad|turn|grad)$/.exec(
          rotate,
        );
        if (!match) diagnostic("non-affine-transform", input.nodeId);
        else {
          const n = Number(match[1]),
            angle =
              n *
              ({
                deg: Math.PI / 180,
                rad: 1,
                turn: 2 * Math.PI,
                grad: Math.PI / 200,
              }[match[2]] ?? 1);
          individualRotate = [
            Math.cos(angle),
            Math.sin(angle),
            -Math.sin(angle),
            Math.cos(angle),
          ];
        }
      }
      const scale = style.getPropertyValue("scale");
      if (scale && scale !== "none") {
        const values = scale.split(/\s+/).map(Number);
        if (
          values.some((value) => !Number.isFinite(value)) ||
          (values.length > 2 && values[2] !== 1)
        )
          diagnostic("non-affine-transform", input.nodeId);
        else local = multiply([values[0], 0, 0, values[1] ?? values[0]], local);
      }
      if (individualRotate) local = multiply(individualRotate, local);
      const zoom = style.getPropertyValue("zoom");
      if (zoom && zoom !== "normal") {
        const value = parseFloat(zoom) / (zoom.endsWith("%") ? 100 : 1);
        if (Number.isFinite(value) && value > 0)
          local = local.map((n) => n * value) as Linear;
        else diagnostic("non-affine-transform", input.nodeId);
      }
      if (element instanceof SVGGraphicsElement) {
        const ctm = element.getScreenCTM();
        if (ctm) {
          // Chromium may expose the legacy six-number SVGMatrix, without is2D.
          // Inspect CSS ancestors separately so SVG CTM flattening cannot hide 3D.
          if (element.parentElement) matrix(element.parentElement);
          if (ctm.is2D === false)
            diagnostic("non-affine-transform", input.nodeId);
          const value: Linear = [ctm.a, ctm.b, ctm.c, ctm.d];
          matrices.set(element, value);
          return value;
        }
      }
      const result = element.parentElement
        ? multiply(matrix(element.parentElement), local)
        : local;
      matrices.set(element, result);
      return result;
    },
  };
  const { expanded } = {
    expanded(
      rect: Rect,
      element: Element,
      edges: { left: number; right: number; top: number; bottom: number },
    ): Rect {
      const [a, b, c, d] = matrix(element);
      const minX =
          Math.min(-a * edges.left, a * edges.right) +
          Math.min(-c * edges.top, c * edges.bottom),
        maxX =
          Math.max(-a * edges.left, a * edges.right) +
          Math.max(-c * edges.top, c * edges.bottom);
      const minY =
          Math.min(-b * edges.left, b * edges.right) +
          Math.min(-d * edges.top, d * edges.bottom),
        maxY =
          Math.max(-b * edges.left, b * edges.right) +
          Math.max(-d * edges.top, d * edges.bottom);
      return {
        x: rect.x + minX,
        y: rect.y + minY,
        width: rect.width + maxX - minX,
        height: rect.height + maxY - minY,
      };
    },
  };
  const { tokens } = {
    tokens(value: string, delimiter: string): string[] {
      const result: string[] = [];
      let depth = 0,
        start = 0;
      for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === "(") depth++;
        else if (char === ")") depth--;
        else if (
          depth === 0 &&
          (delimiter === "," ? char === "," : /\s/.test(char))
        ) {
          if (value.slice(start, i).trim())
            result.push(value.slice(start, i).trim());
          start = i + 1;
        }
      }
      if (value.slice(start).trim()) result.push(value.slice(start).trim());
      return result;
    },
  };
  const { effects } = {
    effects(value: string, text = false) {
      const edges = { left: 0, right: 0, top: 0, bottom: 0 };
      if (!value || value === "none") return edges;
      if (value.length > 20000) {
        diagnostic("effect-limit", input.nodeId);
        return edges;
      }
      const shadows = tokens(value, ",");
      if (shadows.length > 64) {
        diagnostic("effect-limit", input.nodeId);
        return edges;
      }
      for (const shadow of shadows) {
        const fields = tokens(shadow, " ");
        if (fields.includes("inset")) continue;
        const color = fields.find((field) => field.includes("("));
        if (
          color &&
          (/^rgba\(.*[,]\s*0(?:\.0*)?\)$/.test(color) ||
            /\/\s*0(?:\.0*)?\)$/.test(color))
        )
          continue;
        const lengths = fields
          .filter((field) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(field))
          .map(parseFloat);
        if (lengths.length < 2 || lengths.length > (text ? 3 : 4)) {
          diagnostic("shadow-syntax", input.nodeId);
          continue;
        }
        const [x, y, blur = 0, spread = 0] = lengths,
          radius = blur > 0 ? Math.ceil(3 * blur) + 2 : 0;
        edges.left = Math.max(edges.left, spread + radius - x, 0);
        edges.right = Math.max(edges.right, spread + radius + x, 0);
        edges.top = Math.max(edges.top, spread + radius - y, 0);
        edges.bottom = Math.max(edges.bottom, spread + radius + y, 0);
      }
      return edges;
    },
  };
  let result = box(root);
  const { candidate } = {
    candidate(rect: Rect, element: Element, own?: Element, startSelf = false) {
      if (!valid(rect)) return;
      const position = css(element).position;
      const fixed = position === "fixed";
      const containingBlock =
        position === "absolute" && element instanceof HTMLElement
          ? element.offsetParent
          : null;
      let belowContainingBlock = containingBlock !== null;
      for (
        let ancestor: Element | null = startSelf
          ? element
          : element.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        if (
          ancestor.hasAttribute("data-studio-metadata-clip") ||
          ancestor === own
        )
          continue;
        if (ancestor === containingBlock) belowContainingBlock = false;
        const style = css(ancestor);
        // A fixed descendant may escape an intermediate overflow containing block.
        // Ignoring those clips is conservative and never cuts its actual pixels.
        if (
          !fixed &&
          !belowContainingBlock &&
          [style.overflowX, style.overflowY].every((value) =>
            ["hidden", "clip", "scroll", "auto"].includes(value),
          )
        )
          rect = intersection(rect, box(ancestor));
      }
      if (valid(rect)) result = union(result, rect);
    },
  };
  for (const element of elements) {
    if (element.hasAttribute("data-studio-paint-envelope")) {
      const owner = byId.get(
        element.getAttribute("data-studio-paint-envelope")!,
      );
      if (owner && visible(owner)) candidate(box(element), element, owner);
      continue;
    }
    if (
      element.closest("[data-studio-decoration-root]") ||
      !visible(element) ||
      ["DEFS", "SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(
        element.tagName.toUpperCase(),
      )
    )
      continue;
    const style = css(element);
    if (style.filter && style.filter !== "none")
      diagnostic("filter", input.nodeId);
    if (
      ["backdrop-filter", "-webkit-backdrop-filter"].some((property) => {
        const value = style.getPropertyValue(property);
        return value && value !== "none";
      })
    )
      diagnostic("backdrop-filter", input.nodeId);
    if (element.tagName.includes("-") || element.shadowRoot)
      diagnostic("custom-element", input.nodeId);
    for (const pseudo of ["::before", "::after"]) {
      const s = getComputedStyle(element, pseudo);
      if (
        s.content &&
        s.content !== "none" &&
        s.content !== "normal" &&
        s.display !== "none"
      )
        diagnostic("pseudo-element", input.nodeId);
    }
    let rectangle = expanded(box(element), element, effects(style.boxShadow));
    if (style.outlineStyle !== "none") {
      const amount = Math.max(
        0,
        parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
      );
      if (Number.isFinite(amount))
        rectangle = expanded(rectangle, element, {
          left: amount,
          right: amount,
          top: amount,
          bottom: amount,
        });
    }
    if (
      element instanceof SVGGraphicsElement &&
      style.stroke !== "none" &&
      Number(style.strokeOpacity) !== 0
    ) {
      if (
        ["marker-start", "marker-mid", "marker-end"].some((property) => {
          const value = style.getPropertyValue(property);
          return value && value !== "none";
        })
      )
        diagnostic("svg-marker", input.nodeId);
      if (style.getPropertyValue("vector-effect") === "non-scaling-stroke")
        diagnostic("svg-vector-effect", input.nodeId);
      const amount =
        ((parseFloat(style.strokeWidth) || 0) *
          Math.max(1, parseFloat(style.strokeMiterlimit) || 1)) /
        2;
      rectangle = expanded(rectangle, element, {
        left: amount,
        right: amount,
        top: amount,
        bottom: amount,
      });
    }
    candidate(rectangle, element);
    for (const node of [...element.childNodes])
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const font = parseFloat(style.fontSize) || 16;
        const ink =
          style.fontStyle === "normal"
            ? Math.max(1, font / 8)
            : Math.max(2, font / 2);
        const shadows = effects(style.textShadow, true);
        for (const line of [...range.getClientRects()])
          candidate(
            expanded(
              { x: line.x, y: line.y, width: line.width, height: line.height },
              element,
              {
                left: Math.max(ink, shadows.left),
                right: Math.max(ink, shadows.right),
                top: Math.max(ink, shadows.top),
                bottom: Math.max(ink, shadows.bottom),
              },
            ),
            element,
            undefined,
            true,
          );
        range.detach();
      }
  }
  return {
    bounds,
    visualBounds: [{ id: input.nodeId, ...result }],
    diagnostics,
    warnings,
    policy,
  };
}
export function captureMeasurementExpression(
  input: CaptureMeasurementInput,
): string {
  return `(${measureCaptureDOM.toString()})(${JSON.stringify(input)})`;
}
