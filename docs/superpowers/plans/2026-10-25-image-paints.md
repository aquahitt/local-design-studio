# Frame image paints — implementation plan #10

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Workers не коммитят и не пушат; интеграцию выполняет root.

**Goal:** Изображение становится переносимой заливкой фрейма: редактируется человеком и агентом, одинаково рисуется в preview/PNG/React handoff и сохраняется одним revisioned batch.

**Architecture:** Каноническая модель хранит immutable asset path и отображение нормированных координат изображения в локальную систему фрейма. Общий pure compiler формирует безопасное дерево paint-слоёв; React preview и generated handoff имеют только маленькие адаптеры этого дерева. Один self-contained browser resource loader обеспечивает одинаковую готовность и диагностику изображений в iframe, service, Electron и чистом экспорте.

**Tech Stack:** TypeScript/React, существующие ProjectStore/HTTP/MCP, SVG image/pattern, CSS backgrounds/blend modes, Playwright/Electron. Новых runtime dependencies, asset registry и удалённых URL не требуется.

---

## Границы и проверенные факты

База: `codex/image-paints`, исходно `85264ff` с pointer transforms; перед интеграцией сверить main/PR #83. Новая функция — только image fills при `scene.kind=frame`. Multi-strokes, paint текста/вектора и masks остаются отдельными вертикалями #10; issue не закрывается этим изменением. Решение пользователя для будущих masks уже принято: явная группа с выбранным источником, импорт Figma нормализует структуру с сохранением вида/редактируемости.

Текущие файлы: `src/core/paint.ts`, `src/core/handoff.ts::layerStyle`, `src/core/handoff-runtime.ts`, `src/studio/PaintFields.tsx`, `Assets.tsx`, `Preview.tsx`, `iframeentry.tsx`, `src/service/render.ts`, `capture.ts`, `desktop/render.ts`. Формат описывают `docs/project-format.md`, `docs/adr/scene-v2.schema.json`, `docs/superpowers/plans/2026-10-09-frame-paints.md`.

- `PaintBase` уже содержит `id/enabled/opacity/blendMode`; array zero — верхняя заливка, лимит 16, 16 blend modes. `fills` имеет приоритет над legacy `fill`, в том числе пустой список.
- **Legacy stroke — inset boxShadow, а не CSS border.** `layerStyle` объединяет его с inner/outer shadows. Новый DOM paint stack иначе перекроет inset effects; специальный overlay ниже обязателен.
- `POST /api/assets` уже принимает `{data,name,mediaType}` с UI auth. Растры UI нормализует в PNG; SVG проходит owner validator. `ImageAsset.path` — `assets/<64 lowercase hex>.png|svg`; width/height у SVG могут отсутствовать. Сохранять существующие лимиты 8 MiB, PNG 8192/16M pixels и 1000 files, root/hash/symlink guards.
- URL не переписывается в документе. Относительные `/assets` обслуживают Vite/desktop/owner renderer. Handoff сейчас собирает assets только из resolved props; `scene.fills` надо добавить явно. Used/delete scanner уже рекурсивный.
- Readiness сейчас ждёт шрифты, но не decode image/background resources. Успешная пустая PNG при недоступном image paint неприемлема.

## 1. Канонический контракт (зафиксировать до параллельной реализации)

```ts
type ImageMapping =
  | { mode: "cover" | "contain"; anchor: { x: number; y: number } }
  | {
      mode: "crop" | "tile";
      imageToFrame: [number, number, number, number, number, number];
    };
type ImagePaint = PaintBase & {
  kind: "image";
  asset: string;
  mapping: ImageMapping;
};
```

`asset` строго соответствует `/^assets\/[a-f0-9]{64}\.(png|svg)$/`. Никаких URL/data/blob/file, traversal, query/hash, скрытых полей или executable strings в модели. `anchor` обязателен, x/y конечны в 0..1, UI создаёт центр 0.5/0.5. Числа matrix конечны; translations/coefficients ограничены ±1e6, линейная часть следует существующим AFFINE_LIMITS (singular values и condition number), determinant может быть отрицательным, но не нулевым. Не импортировать `scene.ts` runtime обратно в `paint.ts`: scene уже зависит от paint. Worker A выделяет `src/core/affine-validation.ts` с прежними AFFINE_LIMITS и pure numeric validator; `scene.ts` сохраняет прежний export limits через re-export и вызывает общий validator. Image validation использует этот модуль напрямую. Matrix/SceneMetadata импортируются только через `import type`. До расширения image types нужен отдельный RED→GREEN/regression checkpoint, доказывающий прежние accepted/rejected node matrices и отсутствие runtime import cycle; не менять численную политику ради извлечения helper.

**Единицы:** `imageToFrame` отображает источник UV `[0,1]×[0,1]` в local CSS pixels фрейма: `(u,v) → (a*u+c*v+e, b*u+d*v+f)`. Это отдельная матрица заливки, не node transform и не intrinsic pixel coordinates. В модели нет второго источника истины `intrinsicWidth/Height`.

- cover/contain адаптируются к размеру фрейма; anchor использует object-position semantics.
- crop сохраняет размещение исходного UV rectangle при Resize; меняется окно видимости.
- tile повторяет UV unit rectangle с той же локальной матрицей; tile size уже выражен коэффициентами матрицы.
- Scale node wrapper масштабирует готовую композицию вместе с текстом/children.
- cover/contain → crop: дождаться фактического decode, вычислить покрывающий image rectangle, записать `[drawWidth,0,0,drawHeight,left,top]`. При ошибке/непредставимости не подменять режим и не терять черновик. SVG dimensions не угадывать по отсутствующему полю API.

Локальный Chromium probe проверил SVG без width/height с `viewBox="0 0 200 100"`: decoded natural size 300×150; `<image width=1 height=1 preserveAspectRatio=none transform="matrix(120 0 0 80 10 10)">` покрыл весь rectangle 120×80, оба левых угла red, правый blue. Перенести этот случай в настоящий browser regression; probe сам не заменяет приёмку.

Optional extension schemaVersion 2 следует принятому ADR: старые проекты не переписываются при чтении; старый strict reader может не понимать новый paint kind. Путь записи прежний `setNodeMetadata`/общий batch, revision/receipts/locks/Undo не обходятся.

## 2. Общие API и paint representation

Core worker A единолично определяет/экспортирует:

```ts
// src/core/image-paint.ts (или отдельный frame-paint-tree.ts у того же writer)
type ImagePaintReference = { nodeId: string; paintId: string; asset: string };
type FramePaintTree = {
  tag: "div" | "img" | "svg" | "defs" | "pattern" | "image" | "rect";
  props: Record<string, string | number | Record<string, string | number>>;
  children: FramePaintTree[];
};
function hasLayeredFramePaint(scene: FramePaint): boolean;
function compileFramePaintTree(
  nodeId: string,
  scene: SceneMetadata,
): FramePaintTree | undefined;
function collectImagePaintReferences(
  nodes: readonly ProjectNode[],
  mode: "all" | "rendered",
): ImagePaintReference[];
```

Cover/contain используют compiler-only `img` с canonical `src`, `alt=""`, object-fit и непрерывным object-position. Это согласованное расширение закрытого DTO: SVG preserveAspectRatio имеет лишь 9 anchors и не заменяет anchor 0..1. Adapters разрешают только известные src/href относительно доверенного источника ресурсов; CSS URL из модели не разбирается.

Тип `FramePaintTree` — **derived presentation DTO, не поле Project**. Компилятор сам выбирает tags/props, не копирует произвольные props из документа; нет event handlers, raw HTML/CSS/URLs. Адаптер не получает document-controlled tag names. Сервис передаёт `resolveSceneNodes` результат: так definitions/overrides/materialized instances отражают реальный экран. Режим all включает hidden/disabled refs для переносимого экспорта, rendered исключает hidden subtree и disabled paints. Порядок/дедуп refs детерминирован.

CSS-only path при отсутствии enabled image **остаётся неизменным**: `compileFramePaint` выдаёт прежние backgrounds и shadows. При наличии image pure compiler формирует:

1. isolated paint-only stack в logical frame box, pointer-events none, rounded clip независимо от `scene.clip`;
2. слои в обратном DOM порядке (zero paint сверху), существующие gradient CSS/alpha, image cover/contain и SVG crop/pattern tile;
3. inset-effects overlay после заливок, перед children: legacy inset stroke и inner shadows с прежним порядком; outer shadows остаются стилем root;
4. никакого padding, border-box shift, новых data-node-id или изменения начала координат children.

`compileFramePaint` для layered path не рисует второй комплект backgrounds/inset shadows. Worker C в `layerStyle` не добавляет legacy inset stroke в root при layered path; worker A экспортирует нужные compiler helpers/DTO. **Не исправлять это двумя несогласованными CSS формулами.** SVG IDs коллизионно безопасны для произвольных валидных node/paint ID, включая `constructor/__proto__`, Unicode/пробелы/кавычки: не использовать raw IDs как URL/CSS и не соединять неоднозначным delimiter. Нормированная UV схема SVG должна пройти tests с несколькими instances.

## 3. Readiness/диагностика — один контракт

Worker B создаёт `src/library/image-resource-runtime.ts`: self-contained factory `createImageResourceLoader(document, options?)`. Её исходник допускается переносить в generated `imageResources.ts` через `.toString()` **только** если factory не имеет imports/free variables/runtime helpers; clean/minified export test обязан доказать это. Все функции/regex/constants находятся внутри factory, зависимости — только стандартные browser globals и переданные options. Если bundler нарушает closed-source инвариант, вместо небезопасной сериализации использовать явный генерируемый module; не eval/document-controlled code.

```ts
type ImageResourceWarning = {
  code: "PROJECT_IMAGE_UNAVAILABLE";
  asset: string;
};
type ImageResourceReadiness = {
  dimensions: Record<string, { width: number; height: number }>;
  warnings: ImageResourceWarning[];
};
// load({projectId,revision,assets,baseURL?}) -> Promise<ImageResourceReadiness>
// invalidate(asset?), cancel(), dispose()
```

Только canonical paths; resolved URL обслуживается этим же доверенным preview/owner origin/base path. Ни `<base>` из runtime, ни marker чужого компонента не дают произвольного fetch. Decoder ждёт `Image.decode()`/реальный load, возвращает natural dimensions; timeout/ошибка/нечисловые размеры дают warning. Успешные immutable resources кэшируются по project/source/path; pointer transient не создаёт новую decode-сессию. Failed entries повторяются на новой revision/явном retry. Cancel отменяет потребителя snapshot, не ломает ожидающих тот же asset; dispose очищает listeners/timers. Кэш не держит невидимые Image elements после завершения; limit refs не превышает существующий asset budget.

`iframeentry.tsx`: параллельно дождаться fonts и images, затем два RAF. Readiness marker revision обозначает **settled resources**, а не отсутствие warnings. Late result предыдущего input/epoch не меняет marker/parent status. Image warning status содержит projectId/revision и canvas surfaceId/epoch при canvas; parent проверяет origin/source, текущий snapshot и membership asset в его image references, bounded warnings. UI warning вне layout iframe, не смещает picking/карту.

Service/native: после settled marker проверяют image warnings **до PNG**. При недоступном rendered image throw `CoreError("IMAGE_RESOURCE_UNAVAILABLE")` с безопасными asset paths; не возвращают successful blank PNG и не прячут ошибку в generic timeout. Сохраняются 15s outer capture deadline, raster limits, fonts semantics и read-only revision. Missing font fallback остаётся существующим отдельным контрактом. Standalone handoff экспортирует тот же loader и явный `waitForImageResources()`/status, чтобы интегратор и clean-export tests могли ждать правильный кадр; missing bytes не дают полноценный переносимый ZIP.

## 4. Единственные владельцы файлов и порядок

| Writer                      | Владение                                                                                                                                                                                                                                                                                                 | Не трогает                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| A core contract/compiler    | `src/core/paint.ts` **все изменения**; новый `src/core/affine-validation.ts` + минимальный `scene.ts` re-export/refactor; новый `src/core/image-paint.ts`/tree; `src/service/schema.ts`; capabilities в фактическом `src/service/read.ts`; `docs/adr/scene-v2.schema.json`; свои core/schema/store tests | Preview, handoff, UI                              |
| B renderer/resource runtime | новые `src/studio/FramePaintLayer.tsx`, `src/library/image-resource-runtime.ts`; `src/studio/Preview.tsx`, `iframeentry.tsx`; свои loader/SSR/browser tests                                                                                                                                              | paint.ts, handoff.ts, capture/native, PaintFields |
| C owner capture/export      | `src/core/handoff.ts` целиком (включая layerStyle); `handoff-runtime.ts`; `src/service/handoff.ts`, `capture.ts`, `render.ts`; `desktop/render.ts`; свои service/native/handoff tests                                                                                                                    | paint.ts, iframe/Preview/UI                       |
| root интегратор/UI          | `PaintFields.tsx`, `NodeLayoutInspector.tsx`, `App.tsx`, `Assets.tsx` + вынесенный image import helper при необходимости; новый crop editor и pure `imageMappingGesture.ts`; locales, demo parity, user docs; browser end-to-end и конечные проверки                                                     | не параллелит чужие файлы                         |

A сначала публикует согласованные типы/helper signatures. После этого B/C/root независимы; C использует compiler A и loader B после их фиксации. `handoff.ts::layerStyle` меняет только C по согласованному layered contract; это устраняет конфликт двух writers. Любое расширение ownership согласовывается с root до правки. Тяжёлые suites выполняются последовательно; workers не коммитят.

## 5. Задачи TDD

### A1. Типы, validation, schema

- [x] Сначала извлечь нейтральный affine validator/limits без изменения поведения: `scene.ts → affine-validation.ts`, `paint.ts → affine-validation.ts`, **нет** runtime `paint.ts → scene.ts`. Существующие affine unit tests должны пройти без новых tolerance/ослабления limits; добавить import-graph regression в Node/SSR entry.

- [x] RED в новом `src/core/image-paint.test.ts`: нормальные modes; bounds/NaN/singular/ill-conditioned matrix; URI/traversal/nonhash/unknown fields; duplicate paint IDs; non-frame target.
- [x] Запустить `npx vitest run src/core/image-paint.test.ts --maxWorkers=1`, подтвердить причину RED.
- [x] Реализовать тип/validator/compiler helpers; не ослаблять старые paint limits. Синхронизировать service schema/ADR schema и capabilities (image kinds/modes/units/limits), оставив строгий required/closed mapping union.
- [x] GREEN core/scene-schema/schema tests; meaningful batch test invalid-last-operation rollback и reopen/Undo с image paint. Legacy project read/canonical serialization без изменений.

### A2. Общий paint tree

- [x] RED: image между gradients, enabled/opacity/blend/top-first; legacy fills precedence; rounded clip и inset stroke/shadow не перекрыты изображением; stable unique SVG IDs.
- [x] Реализовать safe derived tree. No-image branch сравнить с прежними style objects/paint fixtures точно.
- [x] GREEN чистых tests tree/refs, в том числе hidden/disabled, definitions/materialized instances и произвольных легальных IDs.

### B1. Общий рисунок

- [x] RED SSR плюс настоящие browser pixels PNG и viewBox-only SVG: cover/contain anchors, crop UV reflection/shear/rotation, rotated tile; Resize window против wrapper Scale.
- [x] Подключить FramePaintLayer adapter в **effective** Nodes после transient geometry и до children; не менять logical root bounds/selection.
- [x] GREEN pixel fixtures с radius/legacy stroke/inner+outer shadows и affine parent. Сохранить CSS-only screenshots/hand-off parity.

### B2. Resource barrier

- [x] RED delayed bytes, 404/hash-invalid, decode error/timeout, cancel/revision/epoch change, повторный input с тем же asset без повторного decode, explicit retry/new revision после failure.
- [x] Реализовать loader и iframe barrier/status с действующими guards; warnings UI не меняет geometry/height.
- [x] GREEN реального browser loader под connect-src none/локальными asset routes, без CDN. Tests доказывают, что readiness не наступает до decode.

### C1. Service/native capture

- [x] RED реального `/api/render`/`inspect_read`: delayed image не снимается пустым; missing/hash-invalid asset — конкретная ошибка; source Project/revision не меняются.
- [x] Подключить общий image barrier/warnings в service и Electron; сохранять geometry readiness, capture translation и raster allocation limits.
- [x] GREEN targeted render/API/native tests. Packaged test следует existing `desktop*.spec.ts` routing, не попадает в обычную Linux browser suite.

### C2. Переносимый React export

- [x] RED: image из scene (в том числе definition/instance, hidden/disabled) присутствует в manifest/ZIP; props/font assets не исчезают; symlink/traversal/hash mismatch не обходятся.
- [x] Сериализовать paint tree и добавить короткий React adapter в generated runtime, тот же loader в artifact. Собирать asset refs из props **и** scene, без внешних URL/credentials/абсолютных workspace paths.
- [x] GREEN isolated clean export: unzip в пустой temp, установить fixture dependencies, дождаться resource API и сравнить actual pixels/geometry. Missing bytes не считаются переносимым успешным artifact.

### Root. Управляемый inspector и review

- [x] RED end-to-end: выбрать существующий asset или импортировать в проект, создать image fill, менять mode/anchor/matrix, reorder/enable/opacity/blend, один Apply/Undo и reopen.
- [x] PaintFields остаётся controlled: NodeLayoutInspector владеет одним raw draft/baseRevision. Вынести `imageInput` из Assets только для переиспользования нормализации, не дублировать decoder/limits. Передать narrow asset callbacks/client из App, не читать filesystem из renderer.
- [x] Асинхронные import/decode/conversion привязаны к starting node/paint/project/revision: смена selection/конфликт не применяют результат к другому слою. Неуспешный upload оставляет ввод; успешно импортированный, но не применённый asset остаётся unused, не удаляется автоматически.
- [x] Crop не ограничен raw JSON/шестью непонятными числами. Добавить в PaintFields доступный редактор кадрирования с настоящим изображением и видимым окном фрейма: pan, proportional scale, rotation, reset/fit и числовая альтернатива. Использовать существующий modal/focus primitive, RU/EN/tooltips и reduced motion; отсутствующий/не декодированный resource явно блокирует gesture, а не показывает удачную пустую картинку.
- [x] Root владеет новым pure adapter `src/studio/imageMappingGesture.ts` и его tests. Представить source UV как приватный unit rectangle (`width=height=1`, local `[a,b,c,d,e,f]` из mapping), использовать существующие `createTransformGesture/updateTransformGesture` Move/Scale/Rotate и конвертировать только resulting geometry обратно в imageToFrame. Такая synthetic gesture snapshot не передаётся ProjectStore и не вводит второго paint/node преобразования. Редактор работает в локальной системе фрейма; фактический affine parent применяется обычным shared renderer в документе. Не дублировать corner/pivot/unwrap math в React.
- [x] Interactive crop меняет тот же controlled inspector draft до общего Apply. Захватить project/node/paint ID, revision, mode и resource identity; один RAF обновляет локальный preview, Escape/blur/late callbacks/внешняя правка отменяют gesture. Raw numeric и pointer используют один adapter, invalid final не применяет last-good matrix, нейтральный gesture не создаёт draft/операцию. При конфликте raw draft сохраняется, без silent rebase. Отдельный crop canvas не вызывает основной disabled документный canvas и не публикует свои DOM bounds в editor context.
- [x] cover/contain→crop сохраняет реальные пиксели для PNG и SVG; ошибки/выход матрицы за limits оставляют прежний mode и объяснение. Raw `-`/`1e` сохраняются, Apply отключён до исправления. Числовая матрица остаётся advanced опцией, не единственным UX.
- [x] Agent proposal показывает affected page с теми же image bytes до approval; не выдаёт себе одобрение. Missing image имеет явную диагностику, документ не меняется при preview.
- [x] RU/EN, обе темы, keyboard/focus/ARIA и reduced motion. Demo сохраняет текущую честную политику: import assets доступен в локальной студии; никаких fake FS endpoints/CDN/приватных product fixtures. Новые controls в static demo не падают и объясняют недоступную capability.

## 6. Общая приёмка и гейты

- [x] В одном scene: image между двумя полупрозрачными gradients, разные blend modes, enable/order/opacity; все четыре mappings под affine parent.
- [x] Точные отличия Resize/Scale; radius/clip, legacy inset stroke, inner/outer shadows; children positions неизменны.
- [x] PNG и SVG без API dimensions; actual decoder, matrix conversion без скачка; no-image path без pixel regressions.
- [x] Delayed/missing/hash-invalid/unsafe assets, transient proposal revision/cancel; нет successful blank PNG, SSRF, path escape, executable model strings или утечки токенов.
- [x] Used/delete видит paint refs; materialized instance assets и fonts есть в ZIP; clean preview/service/native/export дают одинаковые pixels/geometry при одинаковом runtime.
- [x] После интеграции root последовательно: `npm run typecheck`, `npm test -- --maxWorkers=1`, `npm run build`, `npm run test:browser`, `npm run test:demo`, `npm run test:accessibility`, `npm run package:desktop`, `npm run test:desktop:packaged`, `git diff --check`. Scope CI сверить с текущими workflows.
- [x] Документы `docs/project-format.md`, `docs/render.md`, `docs/handoff.md`, capabilities/schema и краткий user guide обновлены рядом с реальным кодом. Independent review проверяет resource/cancellation guards и переносимость. Root создаёт draft PR с `Refs #10`, а не `Closes #10`; закрытие/release не объявляются до остальных критериев и ручных gates.

Дополнительного продуктового опроса для image-вертикали не требуется. Технические проверки SVG UV, inset layering и self-contained export loader — обязательные proof checkpoints, не повод молча выбрать упрощённый renderer или потерять совместимость.

## Итог проверки — 2026-10-27

578 unit/contract passed (5 skipped), typecheck/build, browser 78 passed (8 skipped), external library 1, demo 2, accessibility 9; fresh packaged macOS ARM64 4. Release tools 7, MCP clean smoke и performance budgets прошли. Дополнительный целевой image proposal/read-only/approval/Undo сценарий прошёл после общего профиля. Review P2 для >1000 image refs исправлен bounded readiness warnings и проверен в iframe, owner API и generated runtime. Native Image.decode delay и corrupt/missing assets проверены реальным пакетом. PR #83 влит в main2df183f и интегрирован в эту ветку; #10 остаётся открытой для следующих вертикалей.
