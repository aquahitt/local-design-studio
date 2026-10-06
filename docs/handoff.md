# Inspect и React handoff

Inspect выбранного узла объединяет модель документа с фактическими значениями браузера. Read-only `POST /api/inspect` принимает `{pageId, revision, nodeId}`. MCP предоставляет тот же результат через `inspect_read`. Revision обязательна: устаревший снимок отклоняется.

Ответ содержит:

- `node`, `modelStyle` и `resolvedProps` из переносимой модели;
- `tokenRefs` с путями, именами токенов и resolved значениями;
- `component` с ID/version доверенной библиотеки и типом зарегистрированного компонента;
- `localDefinition` для ссылки локального экземпляра;
- реальные DOM `bounds` и `computedStyles.layout` / `computedStyles.content`;
- warnings и диагностику отсутствующего renderer, скрытого слоя или недоступных computed styles.

Computed styles используют фиксированный список свойств `getComputedStyle`, включая размеры, padding/margin, шрифт, цвет, border, transform, opacity, gap и SVG paint. Ключи соответствуют CSS (`font-size`, `padding-left` и т. п.). `layout` относится к обёртке слоя, `content` — к отрендеренному компоненту/примитиву. Inspector не выдаёт значения модели за computed styles. Development Chromium и desktop Chromium собирают одинаковый набор свойств.

## Экспорт зарегистрированного экрана

Read-only `POST /api/handoff` и MCP `react_export` принимают `{pageId, revision}`. UI получает карту файлов и локальные assets для ZIP. Ответ имеет `supported`, `files`, `assets`, `manifest`, `requirements` и `diagnostics`.

Артефакт включает `Screen.tsx`, `Runtime.tsx`, `styles.css`, `tokens.css`, `tokens.json`, `manifest.json`, `package.json` и README. Assets копируются из content-addressed файлов данного проекта; отсутствующий файл остаётся явной диагностикой `MISSING_ASSET`. Произвольные пути и код внешней библиотеки в артефакт не включаются.

Экран получает доверенную библиотеку явно:

```tsx
import { Screen } from './Screen';
import { trustedLibrary } from 'your-registered-runtime';

<Screen library={trustedLibrary} />;
```

Runtime должен совпадать с `manifest.requiredLibrary.id/version`. Интегратор предоставляет CSS библиотеки, локальные шрифты и нужные providers. Manifest перечисляет зарегистрированные компоненты, fields, fixtures, token references, viewport, revision, assets и требования.

Поддержаны существующие семантики зарегистрированного компонентного дерева и объявленные CSS-pixel примитивы сцены: frame, text, vector, image, geometry, rotation, paint, opacity, radius, clip и локальные image fill/crop props. Локальные instances материализуются со своими variants, bindings и overrides. Скрытые слои не рендерятся. Неизвестный компонент, отсутствующая библиотека/тема и компонент `requires-context` обозначаются диагностикой, а не обещанием готового production-кода. Маршрутизация, данные приложения, действия, редакторское выделение, locks и обсуждения не становятся поведением приложения.

## Проверка чистым fixture

`npm test -- src/service/handoff-fixture.test.ts` создаёт отдельный temp-проект только из экспортированных файлов. В него как dependency отдельно устанавливается тестовый provider реальной зарегистрированной builtin-библиотеки; её код не находится в экспортируемом артефакте. Fixture собирается Vite, запускается в Chromium, отображает настоящий Text/Button, затем сравнивает token value, DOM bounds, font-size и padding с browser inspect владельца.

Ресурсы других проектов и приватный product checkout не используются. Проверка офлайн использует установленные development-зависимости студии. Ограничения: системные шрифты зависят от ОС; export — snapshot интеграции поддержанных семантик, а не генератор production-приложения. При смене runtime библиотеки требуется повторная проверка соответствия metadata и fixtures.
