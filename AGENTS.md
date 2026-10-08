# Local Design Studio — инструкции для coding agents

Общайся с пользователем по-русски. UI поддерживает русский и английский: новый текст
проходит через существующий i18n, ключи документа и операций от языка не зависят.

## Назначение и источники

Open source студия интерфейсов с локальными переносимыми данными и общим документом
для человека и AI-агента. Облачная модель допустима; локальное редактирование и
владение проектом не требуют облачного сервиса. Код студии и пользовательские дизайн-
проекты — разные репозитории/папки, лицензия студии не публикует данные пользователя.

- Карта продукта и кода: [.codex/PROJECT.md](.codex/PROJECT.md).
- Работа с Codex: [.codex/README.md](.codex/README.md).
- Публичное описание: [README.md](README.md).
- Формат и восстановление: [docs/project-format.md](docs/project-format.md).
- SDK и внешняя библиотека: [examples/library/README.md](examples/library/README.md).

Перед изменением прочитай документ затронутой области и её вложенный AGENTS.md,
даже если cwd находится в корне. Подробные документы перечислены в карте проекта.
Текущий код, package.json, lockfile и CI проверяют актуальность README/ROADMAP:
пилотные документы могут описывать план, а не текущую реализацию. Если файл или
script отсутствует в checkout, сначала установи его актуальность; не объявляй
функцию реализованной по тексту roadmap или по одной записи версии пакета.

## Команды

Node.js 24.2+; менеджер зависимостей — npm, npm ci использует package-lock.json.
Не переноси pnpm/backend-команды из подключаемого продукта в репозиторий студии.

```bash
npm ci
npm run studio                   # loopback UI + файловый сервис, порт 5178
npm run service -- --project /absolute/path/to/design-project --port 5190
node --import tsx src/service/mcp.ts --project /absolute/path/to/design-project
npm test
npm run typecheck
npm run build
npm run test:browser
```

Для MCP-клиента запускай Node напрямую: stdout остаётся чистым stdio протоколом.
STUDIO_PROJECT выбирает папку данных, STUDIO_LIBRARY_ROOT — доверенную библиотеку
в development. Без явного пути studio использует игнорируемую .studio-project.
Создание проекта разрешено только в пустой папке; никогда не используй настоящий
пользовательский проект как тестовую fixture.

Дополнительные scripts сверяй с package.json и их реализацией в данном checkout:

```bash
npm run build:demo
npm run test:demo
npm run test:accessibility
npm run build:mcp
npm run desktop
npm run test:desktop
npm run make:desktop
npm run test:desktop:packaged
```

Playwright browser tests используют отдельный временный проект и порт 5198;
не подменяй им уже работающую студию на 5178. Для Chromium:
npx playwright install chromium. Для внешнего SDK-примера:
STUDIO_LIBRARY_ROOT=<repo>/examples/library/external npx playwright test tests/studio-external.spec.ts.
Последний путь и script должны существовать в выбранном checkout.

## Архитектурные границы

- src/core — канонический Project, parse/валидация, tokens, scene, operations,
  ProjectStore. Модель не зависит от React, Puck и Electron.
- src/service — HTTP/MCP, аутентификация, schemas, чтение, assets, render/inspect/handoff.
- src/studio — React-редактор, preview, контролы, предложения, i18n и клиент сервиса.
- src/library — SDK, metadata, доверенные React libraries и адаптеры.
- src/demo — отдельный BrowserDemoClient; src/pilot и src/puck — отдельный пилот.
- desktop — Electron main/preload/worker/protocol, если присутствует в checkout;
  src/desktop — UI выбора проектов и проверки оболочки.

## Инварианты документа и записи

1. project.json + assets/ + fixtures/ — переносимый проект. .studio/ — история,
   journal, lock, предложения и приватные подключения; не добавляй её в Git/экспорт.
2. UI и MCP изменяют один ProjectStore через общие типизированные batch operations.
   Проверяется весь пакет; успешная транзакция меняет revision и отменяется целиком.
   Не записывай project.json напрямую при работающем владельце.
3. baseRevision защищает от конфликта; requestId идентифицирует запрос. Повтор того же
   содержимого идемпотентен, повтор ID с другим содержимым отклоняется. Конфликт нельзя
   скрыть автоматической перезаписью или повтором старого пакета с новой revision.
4. Один проект имеет одного файлового владельца. Подключайся к живому сервису;
   не удаляй его lock. Сохраняй atomic write, fsync, pending recovery и отказ записи
   при непонятном состоянии. «Сохранено» означает подтверждённую запись, не UI state.
5. schemaVersion, стабильные projectId/screenId/node IDs и token references — контракт.
   Исполняемый код в документе запрещён. Неизвестные component types/props сохраняются;
   неизвестная версия/структура не обходится ослаблением parser ради открытия файла.
6. Изменение модели сопровождай parser, service schema, операциями, миграцией и
   документацией. Если ADR JSON Schema присутствует, обнови и его. Миграция не должна
   переписать исходник до проверки и успешной резервной копии.
7. PROJECT_LIMITS задаёт допустимый документ. Лимиты и проверки traversal/symlink,
   prototype pollution и пассивного содержимого assets не отключай ради новой функции.

## Агент, библиотеки и режимы

- Agent workflow: capabilities/schema → документ, selection и библиотека → предложение
  с актуальной revision → review/одобрение → применение → проверка результата.
  proposal_create не может одобрить само себя; proposal_apply принимает одобренное
  предложение. Auto-apply — явная политика владельца при запуске, не обход UI review.
- Читай пагинацию до nextOffset=null. Неполный tree или недоступный editor context
  не выдавай за полный документ. inspect/render требуют ревизию; warnings/отсутствие
  computed styles показывай явно, не заменяй данными из модели.
- Путь/код библиотеки задаёт оператор. Документ не выбирает исполняемый модуль.
  Metadata и executable React runtime — разные поверхности. iframe отделяет CSS и
  порталы; доверенная библиотека не становится безопасным недоверенным JavaScript.
- Demo показывает настоящую дизайн-систему самой студии и локальные synthetic fixtures.
  Не добавляй приватный продукт, ключи, внешнюю библиотеку или файловый backend в Pages
  bundle. localStorage демо не означает сохранение файлов проекта на диск.
- Electron renderer и preview не получают Node/fs или произвольный IPC. Сохраняй
  contextIsolation, sandbox, ограниченный preload и проверку sender/origin/path.
- Puck AppState не заменяет канонический документ. Zoom/pan камеры не меняет геометрию
  документа; группы продуктов и фреймы/группы слоёв имеют разные значения.

## Проверка и завершение

Выбирай проверки по изменению. Core/store/schema требуют проверок атомарности,
конфликта, повторов и сохранности данных; UI — целевого браузерного сценария;
MCP — реального protocol/contract теста; desktop — соответствующих IPC/packaged проверок.
Полный профиль CI смотри в .github/workflows, дополнительные demo/desktop jobs отдельно.
Docs-only: существование ссылок, валидность TOML и git diff --check, без продуктового build.

Сохраняй dirty tree и не включай чужие правки в свой коммит. Для новой ветки используй
codex/<slug>, базу сверяй с задачей/remote; не переключай чужую рабочую ветку автоматически.
Commit, push, публикация demo/release и подключение приватной библиотеки — в границах
поручения. Делегирование используй только когда оно разрешено текущей задачей/runtime.
В результате назови изменение поведения, фактические проверки и оставшиеся ограничения.
