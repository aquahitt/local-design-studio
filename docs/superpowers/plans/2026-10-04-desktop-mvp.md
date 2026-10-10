# Desktop MVP Implementation Plan

**Goal:** скачать релиз, запустить студию и работать с файлами без установленного Node/npm.
**Architecture:** Electron shell + sandboxed React + utility process existing service; local protocol routes static files and authenticated service requests.
**Tech Stack:** Electron 44, Forge 8, esbuild, Vite, React, Playwright.

- [x] desktop/project-manager.ts + src/desktop/project-manager.test.ts: real temp-folder tests create/edit/reopen, invalid/nonempty project refusal, close lock and persisted recents. Implement owner lifecycle and atomic user settings.
- [x] desktop/protocol.ts + tests: serve only packaged files and active project assets/API; reject traversal/unknown hosts/routes; bootstrap credentials only local scheme. Main-only IPC checks, no desktop bridge in iframe.
- [x] desktop/worker.ts/main.ts/preload.ts: bundle CJS with esbuild; worker start/stop handshakes with timeout and crash handling; choose folder native dialogs and single-instance app. Release all owners on quit.
- [x] src/desktop/App.tsx/types.ts/styles.css and main.tsx/vite.config.ts: desktop build mode ignores external roots/service Vite plugin; launcher with create/open/example/recent, visible error/busy state, active project toolbar, return home after flush.
- [x] scripts/desktop/build.mjs + Forge config + scripts/workflow: package only built app/runtime/license files; pinned dependencies, platform release assets and checksums, optional signing via secrets, no private product sources.
- [ ] tests/desktop.spec.ts + config: real Electron bundle/packaged app automation create via native bridge selected temp paths in test-only harness; check iframe, edit disk persistence, reopen, invalid open, no Node in preview. Unit/browser/demo regression, package smoke, code review, stacked PR.

Tests are written before behavior, observed failing, then implemented. Complete each unit with meaningful checks. Publication is an unsigned alpha prerelease until signing credentials are available; no claim of notarization or universal clean-machine support.
