import type { DeclarativeTree } from "./primitive-presentation";
import type { MaskDescriptor, MaskDiagnostic } from "./mask-source";
export const EMPTY_MASK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
export const maskImageURL = (svg: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
export const EMPTY_MASK_IMAGE = maskImageURL(EMPTY_MASK_SVG);
const MAX_BYTES = 8_000_000;
const unitless = new Set([
  "opacity",
  "zIndex",
  "fontWeight",
  "lineHeight",
  "flexGrow",
  "flexShrink",
  "order",
  "strokeWidth",
  "fillOpacity",
  "strokeOpacity",
]);
const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const kebab = (key: string) =>
  key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const css = (style: Record<string, string | number>) =>
  Object.entries(style)
    .map(
      ([key, value]) =>
        `${kebab(key)}:${typeof value === "number" && !unitless.has(key) ? value + "px" : value}`,
    )
    .join(";");
/** Resources are prepared by the owner runtime, never supplied by the document as URLs. */
export function serializeMaskSVG(
  descriptor: MaskDescriptor,
  prepared: Readonly<Record<string, string>> = {},
): { svg: string; maskImage: string; diagnostics: MaskDiagnostic[] } {
  const diagnostics = [...descriptor.diagnostics];
  const fail = () => ({
    svg: EMPTY_MASK_SVG,
    maskImage: EMPTY_MASK_IMAGE,
    diagnostics,
  });
  if (diagnostics.length || !descriptor.tree) return fail();
  for (const ref of descriptor.resources) {
    const url = prepared[ref.asset];
    if (
      !url ||
      url.length > MAX_BYTES ||
      !/^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)
    )
      diagnostics.push({
        code: "MASK_IMAGE_UNAVAILABLE",
        nodeId: ref.nodeId,
        feature: "embedded-image",
      });
  }
  if (diagnostics.length) return fail();
  const ids = new Map<string, string>();
  let domain = "mask-";
  for (const code of descriptor.maskId)
    domain += code.codePointAt(0)!.toString(16) + "-";
  const collect = (tree: DeclarativeTree) => {
    if (typeof tree.props.id === "string")
      ids.set(tree.props.id, domain + ids.size);
    tree.children.forEach(collect);
  };
  collect(descriptor.tree);
  let bytes = 0;
  const serialize = (tree: DeclarativeTree): string => {
    if (tree.props["data-studio-metadata-clip"] === "true") return "";
    const props = { ...tree.props };
    if (tree.tag === "svg") props.xmlns = "http://www.w3.org/2000/svg";
    const attributes = Object.entries(props)
      .flatMap(([key, raw]) => {
        if (key.startsWith("data-") || key === "aria-hidden") return [];
        let value: unknown = raw;
        if (key === "style")
          value = css(raw as Record<string, string | number>);
        else if (key === "id") value = ids.get(String(raw)) ?? raw;
        else if ((key === "src" || key === "href") && typeof raw === "string")
          value = prepared[raw];
        else if (
          typeof raw === "string" &&
          raw.startsWith("url(#") &&
          raw.endsWith(")")
        )
          value = `url(#${ids.get(raw.slice(5, -1)) ?? raw.slice(5, -1)})`;
        if (value === undefined) return [];
        const attribute = [
          "clipPath",
          "fillRule",
          "clipRule",
          "strokeWidth",
          "pointerEvents",
          "preserveAlpha",
        ].includes(key)
          ? kebab(key)
          : key;
        return [` ${attribute}="${escape(value)}"`];
      })
      .join("");
    // Fragment references in generated CSS stay in this one standalone SVG document.
    let attrs = attributes;
    for (const [id, replacement] of ids)
      attrs = attrs.split(`url(#${id})`).join(`url(#${replacement})`);
    const opening = `<${tree.tag}${attrs}>`,
      text = escape(tree.text ?? ""),
      closing = `</${tree.tag}>`;
    bytes += opening.length + text.length + closing.length;
    if (bytes > MAX_BYTES) throw new Error("MASK_SOURCE_LIMIT");
    return opening + text + tree.children.map(serialize).join("") + closing;
  };
  try {
    const b = descriptor.bounds;
    const rootStyle = descriptor.tree.props.style as Record<
      string,
      string | number
    >;
    const normalized = {
      ...descriptor.tree,
      props: {
        ...descriptor.tree.props,
        style: {
          ...rootStyle,
          left: Number(rootStyle.left) - b.x,
          top: Number(rootStyle.top) - b.y,
        },
      },
    };
    const body = serialize(normalized);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" preserveAspectRatio="none"><foreignObject x="0" y="0" width="${b.width}" height="${b.height}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${b.width}px;height:${b.height}px;overflow:visible">${body}</div></foreignObject></svg>`;
    if (new TextEncoder().encode(svg).length > MAX_BYTES)
      throw new Error("MASK_SOURCE_LIMIT");
    return { svg, maskImage: maskImageURL(svg), diagnostics };
  } catch {
    diagnostics.push({
      code: "MASK_SOURCE_LIMIT",
      nodeId: descriptor.sourceId,
      feature: "serialized-limit",
    });
    return fail();
  }
}
