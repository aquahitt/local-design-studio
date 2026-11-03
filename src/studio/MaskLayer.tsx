import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Project, ProjectNode } from "../core/project";
import { compileMaskSource } from "../core/mask-source";
import { serializeMaskSVG, EMPTY_MASK_IMAGE } from "../core/mask-svg";
import {
  withTransientGeometry,
  type SceneGeometryMap,
} from "./transientGeometry";
/** The mask owns content presentation only; canonical source DOM is a separate sibling. */
export function MaskLayer({
  node,
  project,
  geometry,
  source,
  children,
  sourceVisible = false,
}: {
  node: ProjectNode;
  project: Project;
  geometry: SceneGeometryMap;
  source: ReactNode;
  children: ReactNode;
  sourceVisible?: boolean;
}) {
  const result = useMemo(() => {
    const present = (value: ProjectNode): ProjectNode => ({
      ...withTransientGeometry(value, geometry),
      slots: Object.fromEntries(
        Object.entries(value.slots).map(([key, rows]) => [
          key,
          rows.map(present),
        ]),
      ),
    });
    const descriptor = compileMaskSource(project, present(node));
    return { descriptor, ...serializeMaskSVG(descriptor) };
  }, [node, project, geometry]);
  const [decoded, setDecoded] = useState<{
    svg: string;
    failed: boolean;
  } | null>(null);
  const ready = decoded?.svg === result.svg && !decoded.failed;
  const failed =
    !!result.diagnostics.length ||
    (decoded?.svg === result.svg && decoded.failed);
  useEffect(() => {
    if (result.diagnostics.length) return;
    let active = true;
    const image = new Image();
    image.src = "data:image/svg+xml," + encodeURIComponent(result.svg);
    void image.decode().then(
      () => {
        if (active) setDecoded({ svg: result.svg, failed: false });
      },
      () => {
        if (active) setDecoded({ svg: result.svg, failed: true });
      },
    );
    return () => {
      active = false;
      image.src = "";
    };
  }, [result.svg, result.diagnostics.length]);
  const b = result.descriptor.bounds,
    g = result.descriptor.groupSize;
  const diagnostics = result.diagnostics.length
    ? result.diagnostics
    : failed
      ? [
          {
            code: "MASK_RENDER_UNAVAILABLE",
            nodeId: result.descriptor.sourceId,
            feature: "svg-decode",
          },
        ]
      : [];
  return (
    <>
      <div
        data-studio-mask-source-holder={node.id}
        aria-hidden={!sourceVisible}
        inert={!sourceVisible}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: g.width,
          height: g.height,
          opacity: sourceVisible ? 1 : 0,
          pointerEvents: sourceVisible ? "auto" : "none",
          ...(sourceVisible ? { zIndex: 1 } : {}),
        }}
      >
        {source}
      </div>
      <div
        data-studio-mask-owner={node.id}
        data-studio-mask-state={failed ? "failed" : ready ? "ready" : "pending"}
        data-studio-mask-diagnostics={JSON.stringify(diagnostics)}
        data-studio-mask-content={node.id}
        style={
          {
            position: "absolute",
            left: b.x,
            top: b.y,
            width: b.width,
            height: b.height,
            maskImage: ready && !failed ? result.maskImage : EMPTY_MASK_IMAGE,
            maskMode: result.descriptor.mode,
            maskRepeat: "no-repeat",
            maskSize: "100% 100%",
            maskPosition: "0 0",
            maskOrigin: "border-box",
            maskClip: "border-box",
            overflow: "hidden",
          } as CSSProperties
        }
      >
        <div
          style={{
            position: "absolute",
            left: -b.x,
            top: -b.y,
            width: g.width,
            height: g.height,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
