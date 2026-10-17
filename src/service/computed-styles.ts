/** Fixed property allowlist excludes DOM text. Resource-valued background images
 * use an explicit marker instead of exposing URLs; gradients remain observable. */
export const COMPUTED_PROPERTIES = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "left",
  "top",
  "color",
  "background-color",
  "background-image",
  "background-blend-mode",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "white-space",
  "overflow-wrap",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-radius",
  "opacity",
  "transform",
  "transform-origin",
  "overflow",
  "gap",
  "row-gap",
  "column-gap",
  "align-items",
  "justify-content",
  "object-fit",
  "object-position",
  "fill",
  "stroke",
  "stroke-width",
];
export const computedStylesExpression = `(() => {
  const properties = ${JSON.stringify(COMPUTED_PROPERTIES)};
  const read = element => {
    const styles = getComputedStyle(element);
    return Object.fromEntries(properties.map(name => {
      const value = styles.getPropertyValue(name);
      return [name, name === 'background-image' && /(?:url|(?:-webkit-)?image-set)\\s*\\(/i.test(value) ? '[resource URL omitted]' : value];
    }));
  };
  return [...document.querySelectorAll('[data-node-id]')].slice(0,10000).map(node => ({
    id: node.getAttribute('data-node-id'), layout: read(node),
    content: node.querySelector('svg path') ? read(node.querySelector('svg path')) : node.firstElementChild ? read(node.firstElementChild) : null,
  }));
})()`;
