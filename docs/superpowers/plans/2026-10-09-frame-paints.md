# Alpha.4: заливки и тени фрейма — план #10

Цель: законченный срез редактирования фонов фрейма, от переносимой модели до
инспектора, сохранения/undo, реального preview/PNG и автономного React handoff.
Полный #10 остаётся открытым: image fills, несколько strokes, masks и paint
текста/вектора не подменяются прямоугольным фоном.

## Принятый контракт

Существующая schemaVersion 2 расширяется optional `scene.fills` и `scene.shadows`.
Отсутствие новых полей сохраняет старую каноническую запись и вид. Оба поля
разрешены только при kind=frame; unsupported surface явно отвергается parser.
Нового пути записи нет: setNodeMetadata, baseRevision, atomic batch, shared undo.

`RGBA={r,g,b,a}`: целые r/g/b 0..255, a 0..1, sRGB. Stable ID каждой заливки/тени
уникален внутри списка. `enabled` default true. Fill opacity default 1.

```ts
type PaintBase = {id:string; enabled?:boolean; opacity?:number; blendMode?:BlendMode};
type Stop = {offset:number; color:RGBA};
type Paint = PaintBase & (
 | {kind:'solid';color:RGBA}
 | {kind:'linear';angle:number;stops:Stop[]}
 | {kind:'radial';center:{x:number;y:number};radius:{x:number;y:number};stops:Stop[]}
);
type Shadow = {id:string;enabled?:boolean;kind:'inner'|'outer';x:number;y:number;
 blur:number;spread:number;color:RGBA};
```

BlendMode — закрытые стандартные normal/multiply/screen/overlay/darken/lighten/
color-dodge/color-burn/hard-light/soft-light/difference/exclusion/hue/saturation/
color/luminosity. Первое значение fills — верхняя заливка. Linear angle: CSS 0° вверх,
90° вправо. Radial center нормирован 0..1, radius по каждой оси >0..4. Stops 2..64,
offset 0..1 неубывающий; одинаковые offset допустимы. Не более 16 fills и 8 shadows.
Shadow x/y/spread ограничены ±4096 px, blur 0..4096 px; все числа конечны.
CSS/URL строки, неизвестные поля/режимы, duplicate IDs и invalid bounds запрещены.

`fills:[]` или все enabled=false дают прозрачный фон и перекрывают legacy fill.
Отсутствие fills использует legacy fill. Shadows добавляются к прежнему inset stroke,
не заменяют его и не сдвигают начало координат children. Layer opacity остаётся
отдельным существующим свойством. Формирование CSS общее для Preview и handoff
через layerStyle; инспектор/агент получают те же modelStyle.

## Распределение и порядок

1. Core worker владеет src/core/paint.ts, paint.test.ts, scene.ts, handoff.ts,
   src/service/schema.ts, docs/adr/scene-v2.schema.json и тестами parser/schema/store.
   Экспортирует типы Paint/Shadow/RGBA/BlendMode, validateFramePaint(scene,path),
   compileFramePaint(scene). Поля общего sceneFields сохраняют partial patch semantics.
   Сначала RED validation/compatibility/compiler/store tests, затем реализация.
2. Frontend worker владеет новым PaintFields.tsx, NodeLayoutInspector.tsx,
   RU/EN ресурсами, i18n registry и tests/paint.spec.ts. Начинает после готового
   core-контракта. Использует существующий единый scene draft, без отдельного onDirty.
   List actions доступны с клавиатуры; controls >=40px; type/group selects StudioSelect.
3. Root выполняет independent review, real PNG/clean handoff fixtures и quality gates;
   commit/push выполняет только root. Существующие чужие dirty worktrees сохраняются.

## Приёмка

- Legacy scene не переписывается; новый fills=[] не возвращает legacy background.
- Порядок двух полупрозрачных fills меняет ожидаемые пиксели. Linear/radial gradients,
  blend и inner/outer shadows реально отображаются; stroke сохраняет child x/y.
- Все model/service/ADR входы согласованы, malformed paint отвергается целиком.
- Инспектор редактирует цвета/opacity/order/visibility, gradient stops/angle/radii,
  shadows; Apply один revision/Undo. Ошибка редактирования исправляется без потери draft.
- Первый переход от legacy fill к stack явно сохраняет либо объясняет замену цвета;
  пустой/выключенный stack не маскируется возвращением legacy.
- Reopen сохраняет IDs/порядок; конфликт с агентом сохраняет draft; locked ancestor
  запрещает запись. Advanced scene JSON проходит те же правила.
- Actual iframe, PNG и автономный handoff имеют одинаковые фоны/тени; неполный #10
  не закрывается. RU/EN, обе темы, keyboard/a11y и соответствующие CI checks.

Технические источники: CSS Backgrounds Level 3 (layering), Compositing Level 1
(background-blend-mode). Произвольный CSS из документа не исполняется.

## Проверенный результат — 2026-10-17

Core, renderer и инспектор реализованы. Независимый review выполнен отдельно от
автора. Найденные malformed JSON, signed-number, pending revision и focus ошибки
воспроизведены RED → GREEN. Нормализация finite angle по модулю 360 защищает от
browser clamp больших чисел, исходник остаётся неизменным.

Фактические локальные гейты: 327 unit/integration passed (5 skipped), typecheck и
production build, 36 browser passed (8 skipped), внешний SDK 1, demo 2 и
accessibility 9. В browser входят 6 paint сценариев: RU/EN × обе темы/keyboard/axe,
Apply/undo/reopen, malformed JSON, signed/fractional input, conflict и focus.
Последняя narrow shadow-kind регрессия проверена отдельно, затем входит в полный
browser набор. Синтетические тестовые сцены не добавляются в публичное demo.

Три isolated React handoff fixtures прошли; paint fixture сравнивает 19 независимых
RGB проб PNG владельца и clean export, реальные computed styles и сохранность
источника. URL/image-set в computed styles заменяются явным marker, проверенным
настоящим Chromium без выдачи синтетического query token.

Desktop dev и packaged macOS arm64: по 2 сценария прошли. Добавление фрейма с
gradient/shadow выполняется настоящим MCP proposal с approval; проверяются native
PNG pixel, computed style, snapshot dimensions и restart. Package собран, ad-hoc
подпись проверена. Standalone MCP build и clean-smoke прошли. Cross-platform CI
этого среза и merge проверяются отдельно; этот документ не утверждает выпуск.

#10 остаётся partial: image fills, несколько strokes, masks и advanced paint
других видов примитивов ещё требуют собственных вертикалей. Отдельно обнаруженная
старая coercion-поверхность общего JSON name/geometry inspector не выдаётся за
исправленную paint guard: для неё требуется собственная регрессия и исправление.
