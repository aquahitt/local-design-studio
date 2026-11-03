export type MaskWarning = {
  maskId: string;
  code: string;
  nodeId?: string;
  feature: string;
};
/** Closed DOM barrier shared by snapshot and portable runtime. No application imports. */
export function createMaskReadinessRuntime(owner: Document) {
  return {
    async wait(
      options: { ids?: readonly string[]; signal?: AbortSignal } = {},
    ): Promise<{ warnings: MaskWarning[]; cancelled?: true }> {
      const allowed = options.ids ? new Set(options.ids) : null;
      const deadline = Date.now() + 10000;
      const codes = new Set([
        "MASK_SOURCE_UNSUPPORTED",
        "MASK_SOURCE_LIMIT",
        "MASK_IMAGE_UNAVAILABLE",
        "MASK_RENDER_UNAVAILABLE",
      ]);
      while (true) {
        if (options.signal?.aborted) return { warnings: [], cancelled: true };
        const rows = [
          ...owner.querySelectorAll("[data-studio-mask-state]"),
        ].filter((element) => {
          const id = element.getAttribute("data-studio-mask-owner");
          return (
            id &&
            (!allowed || allowed.has(id)) &&
            element.closest("[data-node-id]")?.getAttribute("data-node-id") ===
              id
          );
        });
        const pending = rows.filter(
          (row) => row.getAttribute("data-studio-mask-state") === "pending",
        );
        if (!pending.length || Date.now() > deadline) {
          const warnings: MaskWarning[] = [];
          for (const row of rows) {
            const maskId = row.getAttribute("data-studio-mask-owner")!;
            if (row.getAttribute("data-studio-mask-state") === "pending") {
              warnings.push({
                maskId,
                code: "MASK_RENDER_UNAVAILABLE",
                feature: "decode-timeout",
              });
              continue;
            }
            try {
              const diagnostics = JSON.parse(
                row.getAttribute("data-studio-mask-diagnostics") ?? "[]",
              );
              if (!Array.isArray(diagnostics) || diagnostics.length > 100)
                throw new Error();
              for (const diagnostic of diagnostics) {
                if (
                  !diagnostic ||
                  !codes.has(diagnostic.code) ||
                  typeof diagnostic.feature !== "string" ||
                  !/^[a-z-]{1,80}$/.test(diagnostic.feature) ||
                  (diagnostic.nodeId !== undefined &&
                    (typeof diagnostic.nodeId !== "string" ||
                      diagnostic.nodeId.length > 1000))
                )
                  throw new Error();
                warnings.push({
                  maskId,
                  code: diagnostic.code,
                  feature: diagnostic.feature,
                  ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
                });
              }
            } catch {
              warnings.push({
                maskId,
                code: "MASK_RENDER_UNAVAILABLE",
                feature: "invalid-diagnostic",
              });
            }
            if (warnings.length >= 1000) break;
          }
          return { warnings: warnings.slice(0, 1000) };
        }
        await new Promise<void>((resolve) =>
          owner.defaultView!.requestAnimationFrame(() => resolve()),
        );
      }
    },
  };
}
