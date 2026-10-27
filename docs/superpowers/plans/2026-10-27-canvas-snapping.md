# Snapping, rulers and portable guides — #9

> **For agentic workers:** Use superpowers:executing-plans / subagent-driven-development with TDD. Workers do not commit; root integrates. Keep unrelated changes.

**Goal:** Точное размещение одного/нескольких слоёв с умными привязками, переносимыми направляющими и доступными линейками; один жест — один batch/Undo.

**Architecture:** Pure immutable candidate index/solver в core; CanvasSurface передаёт уточнённый pointer существующему transform-gesture. Guides — optional metadata страницы + общие операции ProjectStore, не drawable layers. Подсказки/rulers — editor overlay; не меняют DOM bounds документа и не попадают в PNG/handoff.

**Tech Stack:** Текущие TS/React/ProjectStore/schema/MCP, SVG editor overlays, Vitest/Playwright/packaged Electron. Новые dependencies не нужны.

## Источник и фактическая база

Продолжение найденного в artikeep отчёта «#9: трансформации, snapping и направляющие — проверяемый план» от 2026-10-20 (`transforms-plan.md`). Его ограничения старой rotation-only модели уже сняты PR80–83: affine geometry, отдельные Resize/Scale, числовой inspector и pointer handles реализованы. Изображения PR84 влиты main737ba75. Новый этап сохраняет принятые user decisions; прежний отчёт не переиздаётся как актуальная спецификация.

Существующие helpers: `getTransformFrame`, `transformFramePivot`, `createTransformGesture`, `updateTransformGesture`, `sceneLayers`, `transformPoint`. Использовать их; не восстанавливать parent matrix как world*inverse(local), не менять геометрию после solver произвольными x/y patches.

## Принятый контракт

- Snap targets: видимые физические scene layers текущей страницы; locked слои остаются ориентирами. Model world AABB edges/centres, как align/distribute. Selected independent roots и все их descendants исключены; hidden subtree и virtual instance source nodes исключены. Ancestor frame может быть ориентиром.
- Candidate index строится один раз для immutable gesture snapshot, не на каждом mousemove. Axis indexes отсортированы, поиск ближайших через binary search. Tie-break: guide → object → explicit grid, затем screen distance, stable target ID и source feature. Не использовать locale-dependent ordering.
- Enter 6 CSS screen px, release 9 px. Гистерезис держит выбранную цель до release порога; расчёт всегда относительно raw pointer/captured geometry, без накопления поправок. Нейтральный gesture не создаёт no-op revision.
- Ctrl/Meta временно отключают snapping во всех геометрических жестах; Shift сохраняет constraints/15° rotate, Alt — centre anchor. Modifier changes без движения pointer обновляют preview. Camera pan не проходит snapping.
- Move использует edges/centre union bounds. Resize/Scale: side handle — достижимая прямая; proportional corner — прямая от fixed pivot; свободный corner — две степени свободы. При несовместимых X/Y constraints выбирается достижимый target с минимальным screen displacement. Проверять результат через общий transform helper и показывать только реально достигнутые линии. Fixed anchor не сдвигается ради привязки.
- Grid snapping — отдельная явная опция с фиксированным world spacing/origin; существующая декоративная сетка не становится snap source автоматически и не меняет шаг привязки при zoom.
- Page guides: optional `guides` array `{id,axis:'x'|'y',position,locked?}`; stable nonempty ID ≤200, finite position ±1e6, ≤1000 guides/page, unique IDs. Legacy read не добавляет пустой массив. Guides служат только редактору; передача в Project JSON/операциях/undo обязательна.
- Добавить typed add/move/remove/lock guide operations; locked guide нельзя незаметно переместить или удалить. Source revision захватывается на начало жеста; cancellation/conflict не rebase автоматически.
- Ruler origin world(0,0), nice steps 1/2/5×10ⁿ с отрицательными подписями. Видимость rulers/guides и snap settings — локальные UI preferences, координаты guides — канонический документ. Числовой ввод/клавиатура позволяют создать/переместить/удалить guide без drag. Anchor-to-frame guides остаются отдельным расширением, не обязательной зависимостью world guides.
- Agent получает модель/schema/capabilities guides, те же operations, proposal review с обозначением guide изменений. Он не обходит approval. Numeric node fields сохраняют точный ввод; snapping не добавляется скрыто на сервере.

## Порядок, файлы и проверяемые checkpoints

### 1. Pure move snapping

- [x] RED `src/core/snapping.test.ts`: zoom-invariant threshold, deterministic ties, sticky latch/release, modifier bypass, neutral pointer, frozen inputs, stale capture, hidden/locked/excluded descendants, rotated parents, multi-root union, hostile legal IDs.
- [x] `src/core/snapping.ts`: immutable `buildSnapIndex(gesture, options)`; `solveMoveSnapping(gesture,index,rawPointer,{zoom,bypass,state}) -> {pointer,guides,state}`. `index.source === gesture` обязателен. Target IDs — JSON tuple, не неоднозначный delimiter. Бинарный range search, никаких DOM/React/Store зависимостей.
- [x] GREEN targeted math + existing transform tests; independent expected world edges/centres. Во время этого checkpoint продуктовый CanvasSurface ещё не меняется.

### 2. Constrained Resize/Scale + integration

- [ ] RED расширение solver tests: all handles, affine/reflected/sheared parents, Shift/Alt toggles, incompatible constraints, invalid final, anchor preservation. Compare actual output через transform helper, expected аналитические углы/прямые.
- [ ] Solver dispatch для move/resize/scale; rotate сохраняет существующий angle snap. Только достоверные guide hints после проверки final geometry.
- [ ] `src/studio/CanvasSurface.tsx`: per-gesture index/latch, Ctrl/Meta state в pointer/keyboard, один final recompute, existing cancel/token guards. Новый небольшой `SnapOverlay.tsx`, локальные настройки и RU/EN keys. Не расширять iframe geometry protocol произвольными props.
- [ ] Browser actual pointer: один/несколько слоёв, transformed parents, zoom/pan, модификатор во время held pointer, cancel/revision/delete/lock, one batch/Undo/reopen. No stale overlay/context write.

### 3. Portable page guides

- [ ] Новый `src/core/guides.ts`/tests; ProjectPage/parser, operations, service schema, ADR JSON schema, read capabilities. Closed structures, duplicates/limits, atomic invalid-last-op rollback, locks, no silent legacy rewrite.
- [ ] Добавить guide targets в тот же index. Agent HTTP/MCP create/propose/approve/apply/Undo/reopen uses common store. Metadata read pagination не теряет guides.
- [ ] `src/studio/CanvasGuides.tsx`, guide management fields: ruler drag create; transient guide drag → one captured batch; numeric entry, keyboard move/delete, visible focus, meaningful lock errors. Guide preview не превращается в source node или экспортируемый UI.

### 4. Rulers / docs / final acceptance

- [ ] `src/studio/rulerGeometry.ts`/test: bounded tick generation, nice intervals, negative coordinates, zoom extremes, screen-fixed tick appearance; no hundreds of accessible labels.
- [ ] Rulers and preferences integrate without changing document origin/geometry; fresh canonical bounds epoch after surface measurement. Mobile overflow/reduced motion/RU/EN/light/dark.
- [ ] Update docs/canvas.md, canvas-transforms.md, project-format.md and actual capabilities. Review overlays/cancellation/solver separately. Preserve #9 partial until all original criteria and these checkpoints pass.
- [ ] Root gates sequentially: typecheck, full npm test, build, browser, external library, demo, accessibility, fresh desktop package/native, MCP clean smoke, performance budgets, git diff --check. Only then PR Refs #9; no release tags/manual gates closure.

Опрос о layout/visual capture bounds для будущих внешних strokes ожидает ответа. Этот этап использует model bounds и от него не зависит.

Checkpoint1: 11 snapping tests + existing gesture/geometry tests =69 passed; typecheck и diffcheck green. Solver пока не подключён к UI; Resize/Scale, rulers/guides canonical model ещё не реализованы.
