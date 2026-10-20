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

## Готовность снимка в desktop

`desktop/render.ts` ждёт подтверждения установленного listener `PreviewApp`,
передаёт неизменяемый snapshot один раз и опрашивает готовность нужной revision.
Повторная отправка через короткий интервал не используется: новый input отменяет
ожидающие кадры React-эффекта, поэтому медленный скрытый Chromium мог постоянно
откладывать готовность до `RENDER_TIMEOUT`. Таймаут готовности остаётся 15 секунд.
Служебные `data-studio-preview-*` атрибуты зарезервированы и не заменяются атрибутами
темы библиотеки. Диагностика таймаута содержит стадию и revision, без props,
проектного текста, путей и credentials.

`src/desktop/render.test.ts` воспроизводит готовность медленнее прежнего интервала
повторной доставки. `tests/desktop.spec.ts` дополнительно замедляет кадры настоящего
Electron preview до 220 мс и проверяет PNG страницы/узла через установленный MCP.
Изначальная реализация в этом сценарии воспроизводимо возвращает таймаут; доставка
один раз позволяет кадрам завершиться. Cross-platform packaged CI проверяется
отдельно от локального macOS-прогона.

## Узлы за пределами viewport

`nodeId` снимает полный axis-aligned DOM bounds выбранного узла, включая отрицательные и удалённые координаты. Bounds в ответе остаются в исходных координатах preview (в CSS px); viewport/media queries и Project не меняются. Во временном renderer переводится body, без изменения DOM ancestry; used insets viewport-fixed/initial-CB positioned элементов фиксируются перед переносом. Clip и transforms предков сохраняются. Снимок страницы по-прежнему ограничен viewport и не зависит от камеры редактора.

Raster ограничен 8192 px по стороне и 16 777 216 CSS pixels. Перед native allocation дополнительно проверяются 16384 px по физической стороне и 67 108 864 физических pixels с учётом DPR. Превышение возвращает `RENDER_RASTER_LIMIT`; автоматического уменьшения размера нет. Desktop сохраняет native DPR и цветовой профиль при CDP capture, затем нормализует PNG к CSS pixels через nativeImage; дробный scale CDP не используется.

Finite animations завершаются, infinite отменяются в disposable snapshot до измерения. Новые capture этапы имеют 15-секундный timeout. Проверки: `capture.test.ts`, `capture-browser.test.ts`, `render.test.ts` и настоящий installed-MCP Electron scenario в `tests/desktop.spec.ts`.

Новый native transport сверяется с [Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger) и [CDP Page.captureScreenshot](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot). Debugger подключается только к disposable snapshot window в main process и отсоединяется в finally; editor/preview IPC не расширяется.


Скрытое desktop snapshot окно использует native `capturePage` для одного пикселя
параллельно с CDP node capture: native capturer поддерживает отрисовку страницы,
не показывая BrowserWindow и не меняя CSS viewport. Warm-up PNG отбрасывается;
результатом остаётся bounded CDP PNG. Это следует контракту
[Electron capturePage](https://www.electronjs.org/docs/latest/api/web-contents/#contentscapturepagerect-opts)
и его [реализации v44.5.1](https://github.com/electron/electron/blob/v44.5.1/shell/browser/api/electron_api_web_contents.cc).
Native packaged smoke проверяет pixels удалённых узлов и media-query guard
на сохранность исходного viewport. Timeout и raster budgets не увеличиваются.
