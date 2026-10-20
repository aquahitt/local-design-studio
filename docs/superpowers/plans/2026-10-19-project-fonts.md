# Переносимые проектные шрифты — план реализации

> Для выполнения использовать superpowers:subagent-driven-development или superpowers:executing-plans; каждый контракт проверяется RED → GREEN.

**Цель:** файл шрифта хранится в проекте, выбранное начертание одинаково используется человеком, агентом и экспортом без CDN.

**Архитектура:** optional расширение schemaVersion 2, exact face references. System collection подключается отдельно по явному действию; исходные документы не мигрируются и не переписываются при чтении.

**Стек:** TypeScript, ProjectStore, FontFace, Chromium/Electron, Vitest/Playwright.

- [x] Core: строгие Project.fonts + Scene.textStyle, add/update/removeProjectFont; ссылки страниц и definitions, final batch validation, conflict/undo/reopen. Files: core/fonts.ts, text-style.ts, project.ts, scene.ts, operations.ts; service/schema.ts и ADR schema. `npm test -- src/core/fonts.test.ts src/core/scene-schema.test.ts`.
- [x] Assets: content-addressed ttf/otf/woff/woff2, bounded container/metadata validation, byte descriptors match, authenticated upload; общий project-assets reader во всех service/desktop/export paths. Нельзя удалять bytes, нужные undo.
- [x] Runtime: same-origin FontFace URL (font-src self, connect-src none сохранён); explicit load/add + layout до revision-ready; timeout, stale project/revision cancellation, missing-font diagnostics без изменения документа.
- [x] UI: import и metadata, exact face picker, whole-text lineHeight CSS px/letterSpacing CSS px/align/direction, общий revision draft, RU/EN и keyboard/light/dark.
- [x] Export/demo: единый pure text style compiler; fonts.css + bytes + manifest, missing file unsupported diagnostic. Demo остаётся настоящей DS студии, без приватных шрифтов.
- [x] Приёмка: OFL fixture с provenance и кириллицей; offline, delayed font readiness, 390/1280 переносы, browser + packaged Electron + clean handoff, source document unchanged; npm test/typecheck/build. #12 остаётся открытой до rich text, caret/IME, auto-size и системного подключения.

## Core контракт

`ProjectFont={id,name,assetHash,format:ttf|otf|woff|woff2,family,weight:integer 1..1000,style:normal|italic|oblique}`. Hash lowercase SHA256; file `assets/<assetHash>.<format>`. Metadata names — текст, а не CSS/пути. IDs bounded ASCII. Максимум 128 faces; Unicode names до 160 символов, без control characters.

`textStyle={fontId?,lineHeight?,letterSpacing?,align?:start|center|end|justify,direction?:ltr|rtl|auto}` только kind=text. lineHeight положительный CSS px; letterSpacing signed CSS px; size остаётся scene.fontSize. Отсутствие fontId сохраняет прежний system default.

`addProjectFont {font}`, `updateProjectFont {fontId,font}` (ID неизменен), `removeProjectFont {fontId}`. Удаление used face отвергается final parse; явный remap и удаление возможны одним atomic batch. Варианты/instance overrides меняют props, а не scene: дополнительные scene override возможности не вводятся.

Core проверено: initial RED 5/5 (UNKNOWN_FIELD/UNKNOWN_OPERATION), затем schema RED, targeted fonts/store/ADR 22 passed; полный core прогон 211 passed / 18 files, typecheck и git diff --check пройдены. UI/runtime/assets/export ещё не реализованы этим core-шагом.

## Интеграция и ревью — 2026-10-20

Первый полный unit/integration прогон: 380 passed, 5 skipped. Browser regression:
43 passed, 8 skipped; отдельный новый UI-сценарий font proposal: 1 passed.
Packaged macOS arm64: 3 passed, включая font import, isolated preview,
agent snapshot и повторное открытие. FontFace проверен реальными четырьмя
форматами под CSP connect-src none; delayed/failure readiness, кириллица и clean
handoff проверены, RGBA owner/export совпадают.

Независимое ревью нашло два cache/proposal дефекта, исправленные через RED→GREEN:
loader и HTTP source теперь учитывают полную face metadata identity; requested
snapshot identity валидируется по байтам и не подменяется canonical descriptor.
Поэтому ошибочное предложение даёт warning до принятия, а исправляющее предложение
может показать правильное начертание. Proposal simulation выбирает затронутые
страницы и отдельно показывает descriptor diff. Source document при preview неизменен.

Demo: 2 passed; accessibility: 9 passed. Дополнительно clean font handoff на 390/1280 px: 2 passed. Окончательный UI target fonts+proposal: 6 passed. CI и интеграция с холстом #7 ещё ожидаются.
#12 не закрывается: rich text/caret/IME/auto-size и системное подключение вне этого среза.
