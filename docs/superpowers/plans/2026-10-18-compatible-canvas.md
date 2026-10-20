# Совместимый свободный холст — план реализации

> **For agentic workers:** Use superpowers:subagent-driven-development. Сохранять существующий документ; коммиты выполняет основной агент.

**Goal:** Редактировать слои текущей страницы на свободном холсте, сохраняя просмотр устройств и доступ агента к точным снимкам.

**Architecture:** Камера — предпочтение приложения, вне ProjectStore. Один изолированный iframe рисует существующие узлы, проверенный postMessage сообщает геометрию и выбор; overlay редактора перехватывает жест до интерактивного компонента. Экспорт сохраняет текущую семантику viewport и снимает удалённые узлы независимо от камеры.

**Tech Stack:** React, TypeScript, Playwright, Electron, существующие SceneView и translateSceneLayers.

## Границы

Не объединять страницы, не менять IDs, viewport, device metadata или annotations. Preview оставляет DeviceFrame и интерактивные компоненты; Edit предоставляет pan/zoom/fit/grid/выделение и базовое перемещение. Независимые media queries каждого фрейма не обещаются. Resize/rotate/snapping остаются #9. #7 закрывать только по его проверенным критериям.

## Задача 1 — камера и интерфейс (UI worker)

Файлы: src/studio/canvasCamera.ts и тесты, CanvasSurface.tsx/CSS, Preview.tsx, iframeentry.tsx, App.tsx, LayerActions.tsx, i18n.tsx, tests/canvas.spec.ts; документация редактора.

- [x] RED: zoom anchor сохраняет screenToWorld; fit отрицательных bounds; finite prefs; pointer не запускает кнопку компонента; camera не меняет revision.
- [x] Чистые функции clamp 0.05–16, zoomAtPoint, fitBounds; сохранение versioned camera по project/page с try/catch. Размер viewport не меняет сохранённый документ.
- [x] Edit/Preview toolbar. Пустой canvas origin; первый fit; per-page restore; grid; wheel pan, ctrl/meta-wheel cursor zoom, Space/middle pan, видимый hand tool, fit all/selection/reset.
- [x] Проверенный source/origin/revision/surfaceId geometry/pick bridge. Saved IDs через sceneSelectionId; конечные bounded значения, stale сообщения отбросить. Desktop не использует contentDocument.
- [x] Shift toggle, пустой click, screen-space selection, dirty guard. Базовый scene move: один batch с revision начала, cancel/stale без записи; locked descendants через существующий helper. Preview полностью возвращает взаимодействие компонентам.
- [x] Проверить RU/EN, обе темы, клавиатуру, отрицательные frame coordinates, restore, conflict/undo, отсутствие лишних operations. npm run typecheck; targeted Playwright, затем общая регрессия основным агентом.

## Задача 2 — снимки удалённых узлов (render worker)

Файлы: src/service/render.ts и тесты, desktop/render.ts, src/desktop/render.test.ts, tests/desktop.spec.ts, связанный изолированный capture helper если нужен; docs render contract. UI iframe файлы не менять без согласования.

- [x] Реальный RED: negative и far-positive node capture даёт правильные pixels/dimensions/bounds в service и Electron.
- [x] Временный DOM capture translation сохраняет original bounds и исходный CSS viewport; не менять Project и не включать camera/grid/selection.
- [x] Явный raster budget и диагностируемый отказ oversized, без скрытого downsample. Новые Electron API сверить с установленными типами/официальной документацией.
- [x] GREEN: negative/far/rotated/fractional, clipping, Retina; page screenshot не меняется. Unit + real browser/native smoke.

## Задача 3 — интеграция (основной агент)

- [x] Независимое ревью обеих частей, git diff --check, typecheck/unit/build.
- [x] Browser, demo, accessibility и desktop проверки затронутых сценариев. Записать фактические результаты и ограничения.
- [ ] Commit/push/PR с точным объёмом; ждать CI, затем merge. Не публиковать alpha release до ручных gates #27/#29/#72. Не закрывать частичные #9/#28.

## Интеграция и ревью — 2026-10-19

Перенос DOM выполняется на body без reparent: это сохраняет body>#root selectors. Перед переводом фиксируются resolved insets viewport-fixed/initial-CB элементов; nested transforms/clips не переписываются. Browser regression проверяет fixed/margins/rotation/ancestorclip и fractional bounds. Native CDP сохраняет DPR и ICC, затем существующим nativeImage путём нормализуется к CSS pixels. Отдельный budget ограничивает физическую allocation Retina.

Ревью выявило и исправлено: белая iframe подложка скрывала grid/dark canvas; вторичный удалённый ID мешал drag; поздняя geometry отменённого drag требовала render epoch помимо revision. Picking теперь ждёт React commit нужного epoch, чтобы быстрый клик после Fit не терялся. Протокол проверяет source/origin/surfaceId/revision/epoch, context не объявляет старую геометрию актуальной.

Новые browser fixtures создают и очищают только собственные temporary pages через same-origin UI-authorized API; прежние сценарии не получают чужие canvas страницы. Корректировка fixture не ослабляет product guards.


## Проверки интеграции

- Unit: 355 passed, 5 skipped; browser regression: 50 passed, 8 skipped (до добавления последних трёх целевых жестов).
- Финальный целевой canvas набор: 15 passed (45.3s), включая обе темы/языка, stale pick, отмену drag и вложенный повёрнутый frame.
- Accessibility: 8/9 прошли полным запуском; RU Tab-only не дождался рестарта своей fixture. Отдельный повтор RU с диагностикой: 1 passed (12.2s), весь сценарий с process restart выполнен.
- Demo: 2 passed. Packaged macOS arm64: 2 passed; ad-hoc signature valid. Ручной clean install и screen reader audit остаются gates #27/#29/#72.
- Финальный build/typecheck и git diff --check прошли. Локальные evidence логи хранятся отдельно от данных проекта.
