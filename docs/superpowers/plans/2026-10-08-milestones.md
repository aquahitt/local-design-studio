# Последовательная реализация вех Local Design Studio

> Для исполнителей: использовать subagent-driven-development или executing-plans; перед закрытием issue сверять исходную приёмку и фактический main.

**Цель:** выполнить задачи вех по roadmap #32, сохранив пользовательские документы и честно оценивая полезность каждого выпуска.

**Архитектура:** общий канонический ProjectStore и операции UI/MCP; изолированная ветка интеграции из опубликованного ada78eb. Исходные dirty worktrees не меняются. Независимые desktop/a11y/review задачи исполняются параллельно с раздельным владением файлами.

**Стек:** TypeScript, React, Vite, Vitest, Playwright, Electron, MCP stdio/loopback.

## Правила выполнения

- Порядок: alpha.3 → alpha.4 → alpha.5 → alpha.6 → alpha.7 → дополнительные источники. #32 — общий roadmap, #52 — import epic.
- Спорная задача остаётся открытой. Записывать контекст, таблицу плюсов/минусов, варианты и рекомендацию в опросе; до решения выполнять остальные задачи.
- Перед переходом: перечислить проверенный пользовательский результат, незавершённые критерии, пользу следующего этапа и рекомендацию выпускать/отложить. Переход допустим с явно отложенными задачами; это не означает завершение вехи.
- Готовность: code/tests, main/CI, packaged платформы, ручная доступность, release artifacts — отдельные доказательства. Не заменять чистую установку CI-сборкой, ручной screen reader — axe, PNG render — полным SVG/PDF export.
- Публикация release не следует автоматически из номера версии. При незакрытых gate рекомендуется продолжить следующую веху без выпуска.

## Alpha.3: интеграция и приёмка (#72)

Файлы: .github/workflows/ci.yml, desktop.yml; tests/desktop.spec.ts; tests/accessibility; docs/accessibility.md, desktop.md, project-format.md; root/scoped AGENTS и .codex.

- [x] Изолировать опубликованный baseline ada78eb от существующих незакоммиченных UI-изменений.
- [x] Проверить baseline: npm test (232 passed/5 skipped), npm run typecheck, npm run build, integrity tests (4 passed), test:browser (27 passed/8 skipped).
- [x] Пройти независимое spec/quality review 22 integration issues. Найденные multi-move, stroke-coordinate и CSS-handoff дефекты должны получить regressions и исправления до merge.
- [ ] Пройти updated targeted checks, затем актуальный полный профиль CI. Отдельно external SDK: STUDIO_LIBRARY_ROOT=<checkout>/examples/library/external npx playwright test tests/studio-external.spec.ts.
- [x] Desktop (macOS arm64): npm run test:desktop → npm run package:desktop → npm run test:desktop:packaged; платформа и архитектура записываются, остальные ОС подтверждаются собственными CI/ручными отчётами.
- [x] Accessibility: npm run test:accessibility (9 passed). Проверка клавиатурой RU/EN и restart; VoiceOver/NVDA остаются отдельной ручной приёмкой #29.
- [ ] Создать консолидирующий PR, дождаться обязательных checks, завершить review, интегрировать проверенный scope в main.
- [ ] Закрыть только issues с полностью подтверждёнными исходными критериями; partial/manual gates оставить открытыми. Stacked PR закрывать только если весь diff включён и проверен.
- [ ] Оценить alpha.3: рабочая компонентная студия и агентные proposals уже полезны; отсутствие законченного свободного холста ограничивает самостоятельный дизайн. При pending desktop/a11y gate выпуск отложить; перейти к alpha.4 с перечислением остатка.

## Следующие вехи

- Alpha.4: #7 → #9; #12 после поверхности холста; #10/#11, #13; #28 проверяет новые gestures/text и progress/cancel. Перед реализацией каждой вертикали уточнить UX и написать конкретный план/test контракт.
- Alpha.5: #21/#23; optional #22; #24 после paint/vector/text; #31 — широкий release/compatibility scope.
- Alpha.6: SDK #33 и исследование #51 → SVG #26 → standard readers #34 → fidelity/clone/MCP gate #51.
- Alpha.7: #35/#37/#38 → #36/#40. На старте подтверждать первичные экспортные документы, лицензированный/synthetic sample, версию и loss report.
- Дополнительные источники #39/#41–#50 — capability/sample research перед реализацией. #52 закрывается только после приёмки всех заявленных уровней поддержки.

## Отложенная приёмка

На начало исполнения ручные clean-install/screen-reader результаты отсутствуют. Опрос предлагает CI + независимый ручной аудит; альтернативы — пользовательский аудит или явное отложение. Без фактических результатов #27/#29/#72 не закрываются полностью.

## Проверка исправлений, 2026-10-09

Локальные результаты и границы: [alpha3-acceptance.md](../../alpha3-acceptance.md).
241 unit/integration, 24 общих browser, 1 external SDK, 2 demo, 9 accessibility,
2 packaged desktop macOS arm64 и clean MCP smoke прошли. Полный CI на итоговом
commit и main integration ещё ожидаются; ручные #27/#29/#72 остаются открытыми.
