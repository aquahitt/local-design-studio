import * as React from "react";
// Standalone example: the host binds this renderer to operator manifest metadata.
export const library = {
  sdkVersion: 1,
  capabilities: { jsonProps: true, tokenRefs: true, slots: false },
  id: "external-example",
  version: "1.0.0",
  name: "External example library",
  themes: [],
  tokens: [],
  components: {
    Notice: {
      name: "Notice",
      fields: {},
      defaultProps: {},
      fixtures: [],
      render: ({ message, tone }: { message?: string; tone?: string }) => (
        <aside
          role="status"
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--external-accent)",
            background: "var(--bg)",
            color: "var(--text-primary)",
          }}
        >
          <strong style={{ color: "var(--external-accent)" }}>
            {tone === "warning" ? "Warning" : "Notice"}
          </strong>
          <p>{message ?? "External component"}</p>
        </aside>
      ),
    },
  },
};
