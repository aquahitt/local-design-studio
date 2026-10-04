# Локальная дизайн-система и агентное ядро — implementation plan

> For agentic workers: use superpowers:dispatching-parallel-agents for independent modules; dependency integration and verification are sequential.

**Goal:** подключить реальную локальную библиотеку проекта, её темы и каталог к переносимым документам, надёжному сохранению и stdio MCP.

**Architecture:** компонентные страницы остаются деревом стабильных ID. Общий Node-сервис владеет файловым ProjectStore; UI и MCP обращаются к нему. Дизайн-библиотеки устанавливаются локальным оператором, документы содержат только ID/версию, JSON props и token references. Исполняемый код библиотек не копируется из документов и не публикуется вместе с данными пользователя. Свободный векторный холст остаётся отдельным roadmap.

**Tech Stack:** React/Vite/TypeScript, Node 24, MCP SDK, Vitest/Playwright; подключение существующих TSX/CSS файлов локальной библиотеки.

## Scope

- #2: schemaVersion 2 project, v1 migration, limits, portable paths, unknown component diagnostics, deterministic serialization.
- #3: validated atomic operation batches; baseRevision/requestId, persistent receipts, monotonic undo/redo.
- #4: atomic writes/recovery/lock/external-edit conflicts; saved status only after durable write.
- #5: one loopback document service, origin/auth/root/path validation, headless operation.
- #6: stable UI tree, selection, viewport and dirty input conflict handling.
- #15: typed tokens, aliases, modes/themes, refs, cycle diagnostics and deterministic CSS/JSON export.
- #17/#18: real stdio MCP read/context/proposals/apply; manual approval by default, explicitly enabled auto-apply, audit and one-step undo.
- #30: versioned trusted-library registry with schema/fixtures/renderers, external example adapter, incompatible version diagnostics. No arbitrary extension execution from project files.
- Catalog: source inventory, component examples/states, themes, editable saved pages. Generic open-source example plus local stroi.homes adapter, no private product code copied into studio.

## Module boundaries and contracts

Core owner: src/core/{project,tokens,operations,store}.ts and tests. Project has schemaVersion:2, projectId,name,revision,pages:{screenId,name,viewport:{width},nodes}[],library:{id,version},theme,tokens. Node retains {id,type,props,slots}; JSON props support token reference {$token:string}. Export type Project, ProjectNode, Batch. API parseProject(input), migrateProject(screen), stableStringify(input), applyBatch(project,batch). Operations updateProps(nodeId,props), insertNode(pageId,parentId?,slot?,index,node), moveNode(...), removeNode(nodeId), setViewport(pageId,width), addPage(page), removePage(pageId), renamePage(pageId,name), setTheme(theme), setTokens(tokens). Batch {requestId,baseRevision,description?,author?,operations}. Store: static open(root,options?), read(), apply(batch), undo(requestId,baseRevision), redo(requestId,baseRevision), close(); mutation result Project. Store emits 'change' with Project. Methods are serialized and durable; disk includes history and receipts in ignored .studio. New projects created only explicitly. Validation of registered property schema layered by service; unknown types preserved.

Library owner: src/library/{registry,example,stroi,types} and tests plus adapter build tooling. Library descriptor id/version/components (field schemas, defaults, variants/fixtures), themes and tokens; browser-only renderer module. Local registration must be opt-in, inspectable, version compatible; core doc never imports paths. Provide generic example for clean clone and adapter for local packages/ui primitives, tokens and themes.

Service owner: src/service/{server,api,mcp,cli,proposals} and tests. Shared core store; authenticated HTTP API for project/context/proposals/ops/history, event stream or revision polling. stdio MCP HTTP client connects to running owner, or starts headless owner on explicitly configured root. No competing writer. project_read, pages_list/document_read filtered/paginated, components_list, editor_context, proposal_create/read/apply. Proposal default manual: only UI can approve; MCP apply requires approval or explicit operator auto-apply. Publish tool JSON schemas. Session token outside repo; origin and Host validation. editor heartbeat includes selection/page/viewport/bounds and expiry.

Integration owner: src/studio/{App,client,Editor,Catalog,Inspector,styles}, vite.config.ts, package scripts, docs and browser tests. Keep legacy pilot at /pilot. New studio at / with catalog and page editor. Save on validated action; input draft preserved on revisions. Persist source-independent sample project outside public examples by launch option; repo stores only synthetic examples.

## Tasks / checks

- [x] Install deps and verify original unit baseline.
- [x] Core RED: stale batch, partial failure, retry changed payload, undo monotonic, v1 migration/unknown nodes, alias cycle, real temporary filesystem restart/external edit/lock/failed write. GREEN implement contract and review.
- [x] Library RED: schema reject, compatible version, example discovery, unknown preserved, theme references. GREEN registry/example/local adapter and review.
- [x] Service RED: real HTTP auth/origin/path, proposal approval/stale/idempotence, editor expiry, actual MCP SDK Client handshake/tools/read/create/apply/history. GREEN service and review.
- [x] UI/browser RED: theme/state catalog, persisted text restart/reload, external change retains selection/viewport/draft, one-step undo, proposal approval and incompatible library diagnostic. GREEN integrate renderer and UI.
- [x] Docs: local launch/project paths, MCP config, adapters/trust, schema/migration/recovery, exact issue coverage and boundaries.
- [x] Run unit/typecheck/build/browser; run real local product-adapter build, inspect screenshots and source components; reviewer verifies requirements then quality.
- [ ] Commit verified result; update GitHub issues with evidence, close only criteria actually covered. No publishing private project files.
