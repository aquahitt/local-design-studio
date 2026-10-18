# Защита общего JSON-инспектора

## Подтверждённая проблема

На main после #75 синтаксически корректный JSON в «Параметры слоя JSON» может
передать объект в контролируемый React input. Например, `name:{"toString":null}`
или `scene.width:{"toString":null}` вызывает `Cannot convert object to primitive
value`. Интерфейс редактора размонтируется; сохранённый проект не меняется.

Два реальных browser RED проверяют временный synthetic проект, полный API snapshot,
pageerror, ввод, выделение, Apply, исправление и undo. Оба падают на pageerror;
проверка неизменности сохранённого проекта до этого проходит.

## Исправление

До отображения контролов проверить типы метаданных, которые используются полями:
name, базовые scene strings/numbers/clip и instance definition/variant. Небезопасный
для отображения объект оставляет исходную JSON-строку и исходную revision в draft,
показывает ошибку и блокирует Apply. Остальные поля отображают безопасные сохранённые
значения; это не запись и не исправление исходника. Частичные scene patches с
корректными типами сохраняют существующую семантику. Paint bounds/stops по-прежнему
валидируются отдельно и остаются доступными для численного исправления.

Без изменения parser, операций, формата и путей записи. Это отдельное исправление
редактора, не причина закрывать незавершённый #10.

## Приёмка

- Object name/width не роняют React, raw JSON и focus остаются, Apply disabled.
- Полный сохранённый Project и revision не меняются на невалидном вводе.
- После исправления один Apply сохраняет ожидаемые name/width, Undo возвращает их.
- Существующие paint draft, signed input, конфликт, RU/EN и keyboard не регрессируют.

## Проверка — 2026-10-18

Два новых browser regression воспроизвели RED на прежнем коде, после guard — GREEN 2/2. Полный `npm run test:browser`: 38 passed, 8 skipped (внешние SDK/local fixtures по существующему условию). `npm run build` (включая TypeScript) и `git diff --check` прошли. Независимое read-only ревью не выявило дефектов; instance/partial patch проверены чтением контракта, отдельный новый browser case для них не добавлялся.

## Устойчивость проверок — 2026-10-19

Hosted mac x64 выявил существующие короткие readiness/cold-start ожидания и transient hdiutil Resource busy. Ограничены параллельные тяжёлые test workers (max2), crash-recovery тест воспроизводит реальный старт owner с задержкой2500ms и ждёт connection до10s с early-exit и обязательным cleanup; только cold Vite SSR тест получил20s. Product MCP и его timeout не менялись. DMG допускает максимум3 попытки только для точного create/Resource busy, остальные ошибки сохраняются. Node:test проверяет retry/success/bounds/unrelatedfailures; шаги добавлены в CI.

Проверено:327 unit passed/5 skipped;3 DMG node tests; typecheck; git diff check; YAML обоих workflows разобран. Независимое ревью замечаний не выявило. actionlint в окружении отсутствует; подтверждение hosted mac packaging ожидается в CI.
