# Component library SDK

The bundled `studio-example@1.0.0` library runs in a clean clone. A library has stable `id` and `version`, themes, typed token metadata, and named component definitions. Each definition supplies JSON field schemas, default props, fixtures, states, and a React renderer. `libraryMetadata()` removes executable renderers for the local service. `LibraryRegistry.resolve()` resolves exact versions and reports missing libraries, versions, and components while preserving the original document reference.

Project documents contain only library identity and JSON component data. They cannot install packages, set module paths, choose a filesystem root, or execute code. Register trusted code in application startup configuration. Do not trust a library because a project document references it.

```tsx
import type { ComponentLibrary } from "../../src/library/sdk";

const myLibrary: ComponentLibrary = {
  id: "my-ui",
  version: "1.0.0",
  name: "My UI",
  themes: [],
  tokens: [],
  components: {
    Greeting: {
      name: "Greeting",
      fields: { text: { type: "string" } },
      defaultProps: { text: "Hello" },
      fixtures: [{ name: "Default", props: {} }],
      render: (props) => <p>{String(props.text)}</p>,
    },
  },
};
```

## Optional local project adapter

`studioLibraryPlugin({ externalRoot: process.env.STUDIO_LIBRARY_ROOT })` enables the local adapter only when the operator explicitly configures an absolute checkout root. That root must contain `packages/ui/package.json`, `packages/ui/src/index.ts`, and the token CSS files `base.css`, `theme.css`, `theme-pwa.css`, and `theme-web.css`.

The adapter reads metadata at startup and imports actual renderable exports directly from their source modules, rather than loading the entire package index or cloning styles. Utilities, constants, and hooks are inventoried separately. Field schemas are extracted from the explicit component props declarations; inherited DOM attributes and callback-only props are outside that extraction. Synthetic JSON fixtures cover primitives, data-driven components, games, markdown, and composed tabs. `ServiceForm` and challenge host exports require application-specific contexts and are labeled accordingly. Dialog/layer previews start with an open trigger to keep mounted catalogs usable.

The Vite integration requires `@tailwindcss/vite` and `tailwindcss`. Generated CSS scans the actual external UI source tree and uses the real token contracts with separate `pwa-light`, `pwa-dark`, `web-light`, and `web-dark` preview modes. The currency renderer imports the original local currency font assets. The plugin deduplicates React and permits Vite to serve the configured checkout. Use the same configuration for `getConfiguredLibraryMetadata()` in the service.

This is an opt-in trusted-code adapter, not an untrusted-code sandbox. Source dependencies must already be installed in the checkout. Source paths are resolved through real paths and cannot escape that root by symlink. Keep external-library builds local: they contain the operator's imported code. The repository includes no external proprietary implementations, datasets, token files, fonts, or generated bundles.

```sh
# From the studio checkout; provide your own explicitly trusted root.
STUDIO_LIBRARY_ROOT=/absolute/path/to/your/checkout npm run dev
STUDIO_LIBRARY_ROOT=/absolute/path/to/your/checkout npm test -- src/library/library.test.ts
```

## Runnable external example and versioned manifests

`examples/library/external` is a complete standalone public library. It imports only React and needs no product checkout. Enable it from the studio root:

```sh
STUDIO_LIBRARY_ROOT="$(pwd)/examples/library/external" npm run dev
```

The operator root can provide `studio.library.json` instead of the project-specific `packages/ui` layout. The manifest declares `sdkVersion: 1`, capabilities (`jsonProps: true`, `tokenRefs`, optional `slots`), stable identity, serializable component schemas/defaults/fixtures, themes, tokens, and an `entry` plus `exportName`. The entry is a relative JS/TS module path confined to the configured root, including symlink checks. The module exports a React component library with the same identity; the host binds those renderers to the manifest metadata. Unsupported SDK versions are rejected before importing the entry. The local service reads the same manifest without importing executable library code.

A manifest may declare `migrations: [{ fromVersion, toVersion, renameTypes, renameProps }]`. These are data, never scripts. `applyLibraryMigration(document, metadata, toVersion)` explicitly applies one declared version transition to a cloned JSON document. It preserves unknown component types, unknown properties, and nested slots; it rejects rename conflicts instead of erasing existing properties. Registry resolution never applies migrations automatically. The host/user must choose to invoke a migration and save its output. This foundation exposes the helper; a migration approval UI is not implemented.

Only startup configuration enables a source library. Opening a document that references a library never reads its manifest or loads its entry. Preview iframe isolation limits CSS/DOM interference; it is not an operating-system sandbox. Configured library code runs as trusted code in the Vite/browser environment, including imports performed by its entry. The entry confinement check is not a general sandbox for that trusted module's transitive imports. Use only roots whose code you trust.
