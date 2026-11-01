import { createElement, useMemo, type ReactNode } from "react";
import { type FramePaintTree } from "../core/image-paint";
import {
  compileFrameDecorationTree,
  frameContentClipStyle,
} from "../core/frame-paint";
import { createImageResourceLoader } from "../library/image-resource-runtime";
import type { SceneMetadata } from "../core/scene";
/** Rendering only: tag names/props come from the validated pure compiler, never document code. */
export function FramePaintLayer({
  nodeId,
  scene,
}: {
  nodeId: string;
  scene: SceneMetadata;
}) {
  const resolver = useMemo(
    () =>
      typeof document === "undefined"
        ? null
        : createImageResourceLoader(document),
    [],
  );
  const tree = compileFrameDecorationTree(nodeId, scene);
  function render(branch: FramePaintTree, key: number): ReactNode {
    const props = { ...branch.props };
    const sourceKey =
      branch.tag === "img" ? "src" : branch.tag === "image" ? "href" : null;
    if (sourceKey && typeof props[sourceKey] === "string") {
      const asset = props[sourceKey] as string;
      props[sourceKey] = resolver
        ? (resolver.resolveAssetURL(asset) ?? "")
        : `/${asset}`;
    }
    return createElement(
      branch.tag,
      { ...props, key },
      ...branch.children.map(render),
    );
  }
  return tree
    ? createElement(
        "div",
        {
          "aria-hidden": true,
          style: { display: "contents", pointerEvents: "none" },
        },
        render(tree, 0),
      )
    : null;
}

export function FrameContentClip({
  scene,
  children,
}: {
  scene: SceneMetadata | undefined;
  children: ReactNode;
}) {
  const style = frameContentClipStyle(scene);
  return style ? <div style={style}>{children}</div> : <>{children}</>;
}
