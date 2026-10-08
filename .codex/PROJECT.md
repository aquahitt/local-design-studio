# Local Design Studio — описание для Codex

## Продукт

Студия проектирования интерфейсов, в которой человек и AI-агент работают с одним
переносимым документом. Пользователь видит компоненты и сцену, редактирует экраны,
токены и группы, проверяет предложения агента. Агент получает через локальный MCP
структуру, контекст, схемы и доступные способы изменения того же проекта.

Цель — локальный инструмент дизайна, пригодный для агентной работы и разработки
реальных продуктов. Файлы принадлежат пользователю; Git/GitHub может хранить версии,
но не является обязательным runtime. Модель может быть облачной: это отдельный
выбор пользователя, не основание переносить хранение дизайна в облачный сервис.

## Сценарий

1. Открыть локальную папку проекта или создать проект в пустой папке.
2. Использовать встроенную дизайн-систему либо явно подключить доверенную библиотеку
   продукта и локальные fixtures. Компоненты, требующие providers, показывают диагностику.
3. Собрать/изменить экраны и их слои, токены, варианты и организационные группы.
4. Проверить интеракции, ширины/темы, состояние устройства и результат предложения.
5. Применить проверенный пакет через общие операции; при необходимости отменить его.
6. Сохранить переносимый snapshot и по поручению опубликовать версию обычным Git.

## Данные

| Поверхность | Содержание | Владелец |
|---|---|---|
| project.json | канонический документ, revision, страницы, дерево, библиотека, токены | пользовательский проект |
| assets/, fixtures/ | локальные ресурсы и примерные данные | пользовательский проект |
| .studio/ | lock, recovery journal, история, receipts, предложения и connection keys | локальный владелец; не публичный snapshot |
| metadata библиотеки | типы, fields, fixtures, themes, migrations | доверенный SDK/adapter |
| React runtime библиотеки | исполняемые компоненты, CSS и локальные шрифты | выбранные оператором исходники |
| настройки приложения | недавние проекты, разрешения библиотек, UI preferences | локальная конфигурация, отдельно от документа |

Синхронизируется переносимый документ, а не случайный DOM или внутренний state Puck.
Реализация format/operations определяет поддерживаемые поля. Версия приложения не
равна версии схемы. Сохранение неизвестного component type не означает возможность
отрендерить его без совместимой библиотеки.

## Устройство кода

| Область | Где искать | Граница |
|---|---|---|
| Документ/токены | src/core/project.ts, tokens.ts | runtime-валидация и переносимые данные |
| Операции/история | src/core/operations.ts, store.ts | atomic batch, revision, receipts, undo/redo, recovery |
| Сцена | src/core/scene.ts, design-components.ts, layer-commands.ts | геометрия и definitions/instances отдельно от UI |
| HTTP и MCP | src/service/server.ts, mcp.ts, schema.ts | доступ к одному владельцу, policy и protocol |
| Preview/редактор | src/studio, src/main.tsx | UI, выделение, inspector, предложения, темы и i18n |
| Библиотеки | src/library, scripts/library/plugin.ts | metadata отдельно от executable React |
| Demo | src/demo, Vite mode demo | встроенная studio-ui библиотека, browser storage |
| Pilot | src/pilot, src/puck, src/model | отдельный технический пилот по /pilot |
| Desktop | desktop, src/desktop, scripts/desktop | main/preload/worker, Chromium, ограниченный IPC |
| Проверки | src/**/*.test.ts(x), tests, .github/workflows | unit/contract, browser, demo, desktop и release |

Этот список — карта направлений; наличие desktop/render/handoff сборки и scripts
проверяй в выбранном checkout. При неполной локальной копии не создавай пустую
реализацию только потому, что путь есть в описании.

## Режимы

- Development editor: Vite на loopback, плагин файлового сервиса и локальная библиотека.
- Headless service/MCP: один файловый владелец без открытого UI; editor context может
  быть недоступен. Выбор папки явный, stdio не смешивается с диагностикой launcher.
- Pages demo: статическое приложение, собственная дизайн-система и browser storage.
  Оно демонстрирует интерфейс, не предоставляет удалённый доступ к папкам пользователя.
- Desktop: Electron включает runtime и управляет локальными процессами. Preview
  изолировано от IPC редактора, библиотеку разрешает оператор. Packaged приложение
  проверяется отдельно от development Electron; build не доказывает подпись/notarization.

## Границы и направление развития

Alpha — основа редактора и платформы агентного дизайна. Прототип scene, React-компоненты,
локальные definitions/instances, render/inspect/handoff и обсуждения проверяются по
коду и своим контрактам. Их наличие не означает полного паритета с Figma.

Импорт сторонних редакторов, автоматическая Git-синхронизация, совместное редактирование
и полноценная генерация production-приложения не следуют из экспортируемого JSON/React
snapshot. Статус каждого направления сверяй с текущими issues и реализацией. Импорт
должен сохранять происхождение и диагностировать потери; экспорт не переносит
маршрутизацию, providers и backend-поведение продукта автоматически.

Студия остаётся самостоятельным open source проектом. Адаптер stroi.homes — один из
подключаемых продуктов; его API, бизнес-модель и секреты не становятся частью ядра.

## Документация доступного checkout

| Документ | Когда читать |
|---|---|
| [docs/project-format.md](../docs/project-format.md) | Канонический формат, транзакции, lock и восстановление |
| [examples/library/README.md](../examples/library/README.md) | SDK, manifest, fixtures и доверие внешнему коду |
| [docs/adr/0001-portable-scene.md](../docs/adr/0001-portable-scene.md) | Scene, instances, geometry и граница Puck |
| [docs/compatibility.md](../docs/compatibility.md) | Миграции и безопасный откат данных |
| [docs/groups.md](../docs/groups.md) | Группы страниц, компонентов и токенов |
| [docs/device-preview.md](../docs/device-preview.md) | Viewport, устройства, системные зоны и mock шторки |
| [docs/annotations.md](../docs/annotations.md) | Комментарии, decisions и orphaned anchors |
| [docs/render.md](../docs/render.md) | PNG снимок, revision и реальные DOM bounds |
| [docs/handoff.md](../docs/handoff.md) | Inspect и React/CSS/tokens экспорт |
| [docs/desktop.md](../docs/desktop.md) | Electron, доверенные библиотеки и MCP установленного приложения |
| [docs/release.md](../docs/release.md) | Сборка, версии и проверка release artifacts |
| [docs/accessibility.md](../docs/accessibility.md) | Keyboard, focus и a11y сценарии |
| [docs/performance.md](../docs/performance.md) | Пределы и измерения производительности |

Ранние docs/design.md, pilot-plan и ROADMAP полезны как история решений; проверяй их
утверждения текущим кодом. При изменении контракта обновляй предметный документ и
инструкции затронутой области, не дублируй здесь полный технический справочник.
