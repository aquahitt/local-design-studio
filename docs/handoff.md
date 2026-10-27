# Inspect и React handoff

Inspect выбранного узла объединяет модель документа с фактическими значениями браузера. Read-only `POST /api/inspect` принимает `{pageId, revision, nodeId}`. MCP предоставляет тот же результат через `inspect_read`. Revision обязательна: устаревший снимок отклоняется.

Ответ содержит:

- `node`, `modelStyle` и `resolvedProps` из переносимой модели;
- `tokenRefs` с путями, именами токенов и resolved значениями;
- `component` с ID/version доверенной библиотеки и типом зарегистрированного компонента;
- `localDefinition` для ссылки локального экземпляра;
- реальные DOM `bounds` и `computedStyles.layout` / `computedStyles.content`;
- warnings и диагностику отсутствующего renderer, скрытого слоя или недоступных computed styles.

Computed styles используют фиксированный список свойств `getComputedStyle`, включая размеры, padding/margin, шрифт, цвет, background-image/background-blend-mode, box-shadow, border, transform, opacity, gap и SVG paint. Ключи соответствуют CSS (`font-size`, `padding-left` и т. п.). `layout` относится к обёртке слоя, `content` — к отрендеренному компоненту/примитиву. Inspector не выдаёт значения модели за computed styles. Если `background-image`
доверенного runtime содержит resource URL или image-set, inspect возвращает явный
маркер `[resource URL omitted]`, сохраняя градиенты без изменений. URL ресурсов и
их query-параметры не включаются в этот набор computed styles. Development Chromium и desktop Chromium собирают одинаковый набор свойств.

## Экспорт зарегистрированного экрана

Read-only `POST /api/handoff` и MCP `react_export` принимают `{pageId, revision}`. UI получает карту файлов и локальные assets для ZIP. Ответ имеет `supported`, `files`, `assets`, `manifest`, `requirements` и `diagnostics`.

Артефакт включает `Screen.tsx`, `Runtime.tsx`, `styles.css`, `tokens.css`, `tokens.json`, `manifest.json`, `package.json` и README. Assets копируются из content-addressed файлов данного проекта; отсутствующий файл остаётся явной диагностикой `MISSING_ASSET`. Произвольные пути и код внешней библиотеки в артефакт не включаются.

Экран получает доверенную библиотеку явно:

```tsx
import { Screen } from "./Screen";
import { trustedLibrary } from "your-registered-runtime";

<Screen library={trustedLibrary} />;
```

Runtime должен совпадать с `manifest.requiredLibrary.id/version`. Интегратор предоставляет CSS библиотеки, локальные шрифты и нужные providers. Manifest перечисляет зарегистрированные компоненты, fields, fixtures, token references, viewport, revision, assets и требования.

CSS-экспорт использует общую `serializeCSSValue` из `src/core/tokens.ts`: токены `string` становятся quoted CSS strings, кавычки и обратная косая черта экранируются, управляющие символы — hexadecimal escapes. Настоящий перенос строки сохраняется как `\a `, а не JSON-последовательность `\n`. Значения без кавычек, включая `fontFamily`, с разделителями деклараций или CSS-комментариями отклоняются как `UNSAFE_TOKEN_CSS`. Та же сериализация применяется к inline CSS variables экспортированного экрана; исходные значения в `tokens.json` не меняются.

Handoff сохраняет имена CSS variables preview с одним префиксом `--`; `surface` и `--surface` вместе дают `TOKEN_CSS_COLLISION`. Отдельный `exportTokensCSS` сохраняет прежнюю нормализацию точек/подчёркиваний в дефисы и проверяет её коллизии. Корень сцены позиционируется относительно контейнера с теми же отступами body 20 px, что preview; минимальная высота scene-контейнера равна `viewport.height` или 850 px по умолчанию. Вложенная обводка рисуется внутри рамки, не смещая координаты потомков.

Для фреймов `layerStyle` использует общий `compileFramePaint`: solid/linear/radial
fill stack, per-fill opacity, background blending и inner/outer shadows компилируются
из структурированных sRGB данных. Handoff и preview получают один и тот же набор
CSS declarations; stroke остаётся inset и не смещает потомков. Пустой `fills` —
прозрачный фон. Неподдерживаемый paint других видов примитивов отвергается parser,
а не заменяется прямоугольной заливкой при экспорте.

Поддержаны существующие семантики зарегистрированного компонентного дерева и объявленные CSS-pixel примитивы сцены: frame, text, vector, image, geometry, rotation, paint, opacity, radius, clip и локальные image fill/crop props. Локальные instances материализуются со своими variants, bindings и overrides. Скрытые слои не рендерятся. Неизвестный компонент, отсутствующая библиотека/тема и компонент `requires-context` обозначаются диагностикой, а не обещанием готового production-кода. Маршрутизация, данные приложения, действия, редакторское выделение, locks и обсуждения не становятся поведением приложения.

## Проверка чистым fixture

`npm test -- src/service/handoff-fixture.test.ts` создаёт отдельный temp-проект только из экспортированных файлов. В него как dependency отдельно устанавливается тестовый provider реальной зарегистрированной builtin-библиотеки; её код не находится в экспортируемом артефакте. Компонентный и scene fixtures собираются Vite, запускаются в Chromium, отображают настоящий Text/Button, затем сравнивают token value, DOM bounds, font-size и padding с browser inspect владельца. Paint fixture дополнительно сравнивает независимые ожидаемые RGB-пиксели и PNG владельца с отдельно собранным handoff: порядок/alpha, градиенты, background blend, тени, stroke и clipping. Scene fixture дополнительно проверяет координаты вложенного слоя при обводке 10 px и высоту контейнера; CSS fixture проверяет реальный перенос строки в `content: var(...)`.

Ресурсы других проектов и приватный product checkout не используются. Проверка офлайн использует установленные development-зависимости студии. Ограничения: системные шрифты зависят от ОС; export — snapshot интеграции поддержанных семантик, а не генератор production-приложения. При смене runtime библиотеки требуется повторная проверка соответствия metadata и fixtures.

## Переносимые заливки изображениями

Image fills фрейма рисуются общим `compileFramePaintTree`; preview и экспорт
адаптируют одно безопасное дерево. Cover/contain используют непрерывную привязку,
crop/tile — матрицу из нормированных UV в local CSS px. URL ресурса разрешается
единым runtime относительно доверенной директории, без использования `<base>`
доверенной React-библиотеки. Порядок paint stack, inset stroke и тени сохраняются.

Manifest и ZIP включают ссылки из scene paints, в том числе из материализованных
экземпляров и скрытых/выключенных заливок, наряду с ресурсами props и шрифтами.
Экспорт проверяет hash и допустимое содержимое изображения; отсутствующий или
повреждённый файл даёт `supported:false` с `MISSING_ASSET`. Такой результат нельзя
считать полным переносимым артефактом.

Архив содержит `imageResources.ts`. API `waitForImageResources({baseURL?})`
возвращает размеры декодированных изображений и предупреждения;
`getImageResourceStatus()` показывает состояние ожидания. `Screen` принимает
необязательный `assetBaseURL` в пределах того же origin; по умолчанию используется
директория URL документа. Интеграционный screenshot должен дождаться этого API и
проверить warnings. Для сборки Vite перенесите каталог архива `assets/` в
`public/assets/`, чтобы файлы попали в dist; пример README в экспорте описывает шаг.

`src/service/image-handoff-fixture.test.ts` распаковывает ZIP в чистую временную
папку, собирает его Vite/minify и сравнивает реальные пиксели с `/api/render`.
Проверяются четыре режима, SVG без asset dimensions, задержка декодирования и
явные ошибки при повреждении/удалении ресурса, без записи в source project.
