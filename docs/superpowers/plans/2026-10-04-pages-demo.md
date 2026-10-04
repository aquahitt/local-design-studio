# GitHub Pages Demo Implementation Plan

**Goal:** публикуемое интерактивное браузерное демо без локального сервиса и приватных библиотек.
**Architecture:** отдельный demo build mode + browser adapter к общему core; существующий UI и isolated preview runtime.
**Tech Stack:** React/Vite, localStorage, Vitest, Playwright, GitHub Pages Actions.

- [x] src/demo/client.test.ts: failing tests persistence/history, validation atomicity, stale revisions, proposal approval and recovery. Browser storage is injected for deterministic tests. Implement src/demo/project.ts and src/demo/client.ts using applyBatch/parseProject/validateComponentProps; persist before updating memory. No server/Node imports.
- [x] src/studio/client.ts chooses BrowserDemoClient only in compile-time demo mode; src/demo/Banner.tsx labels demo/reset/repo. App save/toolbar/agent descriptions distinguish browser storage and simulated proposal. Keep local mode unchanged.
- [x] vite.config.ts demo ignores externalRoot/projectEnv, omits service plugin, defines __STUDIO_DEMO__, sets /local-design-studio/ base. Preview/main use query route on static Pages. npm scripts build:demo/preview:demo.
- [x] playwright.demo.config.ts runs static preview5199; tests/demo.spec.ts validates root/subpath, theme/iframe, persisted edit, one-step undo, simulated proposal, reset and zero /api calls. Build with a configured private root and verify it is excluded.
- [x] scripts/demo-notices.mjs aggregates installed dependency LICENSE notices into dist. Pages workflow checks+builds+uploads/deploys clean artifact, pinned official actions. README demo link and limitations.
- [ ] Run meaningful checks, request review, commit/push stacked PR, enable Pages source, verify deployment and clean local studio remains unchanged.
