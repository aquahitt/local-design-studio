# Снимки документа для агента

`document_render` читает текущий проект владельца и возвращает PNG, полученный реальным Chromium с тем же `PreviewApp`, библиотекой, темой и токенами, что и превью редактора. Изображение передаётся как native MCP image; текстовый ответ содержит метаданные без повторения base64.

Аргументы:

```json
{
  "pageId": "home",
  "revision": 7,
  "viewport": { "width": 390, "height": 844 },
  "nodeId": "optional-node-id",
  "theme": "optional-theme-id"
}
```

`pageId` и `revision` обязательны. Без `viewport` используется viewport страницы (высота по умолчанию 850). Без `nodeId` снимается видимая область страницы; с `nodeId` — изображение соответствующего DOM-узла. Выбор узла не меняет выделение пользователя. `theme` по умолчанию берётся из проекта.

Ответ сохраняет `revision`, `pageId`, `nodeId`, `viewport`, `theme`, DOM `bounds` с ID и координатами узлов, `warnings` и первые 10 000 символов отрендеренного текста для проверки. Координаты bounds относятся к странице до обрезки выбранного узла. Изображение имеет `mimeType: image/png`.

Устаревшая revision отклоняется с `REVISION_CONFLICT`. Отсутствующие страница и узел возвращают `PAGE_NOT_FOUND` / `NODE_NOT_FOUND`; скрытый или неотрендеренный узел — `NODE_NOT_VISIBLE`. Размеры viewport проверяются теми же ограничениями, что и размеры страницы. Отсутствие доверенной библиотеки или её темы даёт `LIBRARY_UNAVAILABLE` / `INVALID_THEME`. Ошибки компонентов отображаются в изображении и перечисляются в `warnings`.

HTTP-эквивалент — аутентифицированный `POST /api/render` с теми же аргументами. HTTP-ответ содержит `data` в base64 и остальные метаданные. Публичного пути к файлу, произвольного URL и команды браузера в API нет.

## Локальная разработка

Владелец передаёт read-only callback `renderSnapshot(project, options)`. Реализация `src/service/render.ts` сначала проверяет аргументы и клонирует документ, затем собирает отдельный статический renderer через Vite без плагина сервиса студии. На время снимка открывается отдельный loopback HTTP-сервер только со сборкой renderer и content-addressed SVG/PNG данного проекта. Остальные сетевые запросы блокируются. Доступ к исходникам соседних проектов и запись изменений не предоставляются.

Для development-снимков нужны установленные зависимости студии и Chromium Playwright:

```bash
npx playwright install chromium
npm run service -- --project /absolute/path/to/design-project
```

Launcher MCP может сам запустить headless-владельца с development-renderer. Автономный helper без checkout и необязательных development-зависимостей может подключиться к существующему владельцу со своим callback. Если development-renderer недоступен, возвращается `RENDER_UNAVAILABLE`; если не установлен Chromium — `RENDER_BROWSER_UNAVAILABLE`. Desktop-владелец использует Chromium из Electron и тот же контракт снимка. Его PNG нормализуется к одному пикселю изображения на CSS pixel независимо от масштаба дисплея, включая Retina. Для страницы размеры PNG совпадают с `viewport`; для обрезанного узла — с округлёнными вверх шириной и высотой его DOM bounds.

Проверки `src/service/render.test.ts` снимают настоящий Text-компонент при ширине 390 и 1280, проверяют PNG, фактический текст, bounds, revision и отсутствие изменений исходного документа. Сценарий агента применяет `updateProps` через общий движок операций: длинный текст на новой revision занимает больше строк при 390, чем при 1280, что подтверждается высотой DOM bounds. Отдельная проверка снимает реальный компонент внешнего manifest в dark-теме и обрезает выбранный узел. Тесты воспроизводятся через `npm test -- src/service/render.test.ts src/service/mcp.test.ts`; PNG для visual QA сохраняются в системном temp как `studio-alpha3-render-390.png`, `studio-alpha3-render-1280.png` и `studio-alpha3-render-external-node.png`.

Ограничения: координаты bounds — CSS pixels при deviceScaleFactor=1; в development-снимке снимается поверхность preview без интерфейса редактора и декоративной рамки устройства. Системные шрифты зависят от ОС; локальные шрифты включаются в сборку доверенной библиотеки. Сетевые ресурсы не загружаются и отмечаются в warnings. Full-page capture не выполняется: изображение страницы ограничено указанным viewport.
