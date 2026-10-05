/** Track both ordinary content and portalled/floating content inside a preview. */
export function observePreviewSize(
  content: HTMLElement,
  report: (height: number, width: number) => void,
): () => void {
  let frame = 0;
  let disposed = false;
  let previous = "";
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(measure);
  };
  const resize = new ResizeObserver(schedule);
  const observed = new Set<Element>();
  function measure() {
    frame = 0;
    const nodes = [...document.body.querySelectorAll<HTMLElement>("*")];
    const present = new Set<Element>(nodes);
    for (const node of observed)
      if (!present.has(node)) {
        resize.unobserve(node);
        observed.delete(node);
      }
    const fixed = new Set<HTMLElement>();
    const visible: HTMLElement[] = [];
    let height = content.getBoundingClientRect().height + 40;
    let width = innerWidth;
    for (const node of nodes) {
      if (!observed.has(node)) {
        resize.observe(node);
        observed.add(node);
      }
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        node.closest('[hidden], [data-state="closed"]')
      )
        continue;
      visible.push(node);
      // Centred dialogs can overflow on both edges; reserve both margins.
      width = Math.max(
        width,
        innerWidth + 2 * Math.max(0, -rect.left, rect.right - innerWidth),
        node.scrollWidth > node.clientWidth + 1 ? node.scrollWidth + 40 : 0,
      );
      if (style.position === "fixed") {
        fixed.add(node);
        // Full-screen backdrops/layout wrappers follow viewport height themselves.
        // Reserve a useful viewport instead of feeding their height back forever.
        if (rect.width >= innerWidth - 2 && rect.height >= innerHeight - 2)
          height = Math.max(height, 640);
      }
    }
    for (const node of visible) {
      let ancestor: HTMLElement | null = node;
      let floatingViewport = false;
      while (ancestor && ancestor !== document.body) {
        if (fixed.has(ancestor)) {
          floatingViewport = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      const rect = node.getBoundingClientRect();
      if (!floatingViewport)
        height = Math.max(height, rect.bottom + scrollY + 20);
      else if (node.getAttribute("role") === "dialog") {
        height = Math.max(height, 640);
        if (node.scrollHeight > node.clientHeight + 1)
          height = Math.max(height, node.scrollHeight + 80);
      } else if (fixed.has(node) && rect.height < innerHeight - 2) {
        height = Math.max(height, rect.bottom + 20, rect.top < 0 ? 640 : 0);
      }
    }
    height = Math.max(120, Math.min(1600, Math.ceil(height)));
    width = Math.min(1600, Math.ceil(width));
    const size = `${height}:${width}`;
    if (size !== previous) {
      previous = size;
      report(height, width);
    }
  }
  const mutation = new MutationObserver(schedule);
  mutation.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  window.addEventListener("resize", schedule);
  document.addEventListener("load", schedule, true);
  document.addEventListener("transitionend", schedule, true);
  document.addEventListener("animationend", schedule, true);
  void document.fonts.ready.then(schedule);
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutation.disconnect();
    window.removeEventListener("resize", schedule);
    document.removeEventListener("load", schedule, true);
    document.removeEventListener("transitionend", schedule, true);
    document.removeEventListener("animationend", schedule, true);
  };
}
