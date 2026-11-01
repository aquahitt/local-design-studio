# Frame strokes and compatible visual capture — #10

Продолжение найденного в artikeep `alpha4-paint-design.md` от 2026-10-09.
Fills/shadows реализованы PR75, image fills PR84; трансформации/привязки #9 завершены PR85.
Это рабочий план следующей вертикали, не заявление о готовности #10.

Пользователь выбрал layout/visual bounds: прежние API сохраняют layout по умолчанию,
новый UI-экспорт включает оформление. Исходная geometry/selection/layout не меняется.
Маски — явная группа с выбранным источником, отдельный следующий участок.

## Контракт и критерии

- `scene.strokes?: (Paint & {width:number,alignment:inside|center|outside})[]` только frame,
  до16, width0..4096, topfirst. Все существующие solid/linear/radial/image paints.
- IDs уникальны внутри стека; одинаковые IDs fills/strokes не конфликтуют в DOM/SVG.
- Отсутствие массива сохраняет legacy inset stroke. Явный массив, включая[], его заменяет.
- Никаких border/padding или сдвига origin детей ради обводки. Собственный clip обрезает
  children, но сохраняет outside stroke. Clip предка продолжает обрезать всё потомство.
- Image stroke mapping относится к внешнему paint bbox обводки; image fills по-прежнему
  относятся к frame bbox. Readiness/asset usage/delete/ZIP учитывают оба стека.
- Shared pure descriptor используется editor, service/native snapshots и standalone React.
  Preview/approval/Undo/raw inspector drafts сохраняют прежние guarantees.
- Bounds: exact stroke outsets; отдельный conservative raster envelope известных outer
  CSS box-shadows, с явной policy/status. Это не tight alpha crop и не обещание конечного
  математического Gaussian support. Children/ancestor clip и external React отдельно.
- API `boundsMode?:layout|visual` defaultlayout; старое bounds сохраняет смысл. Новые
  visualBounds/captureBounds дают origin PNG. Без nodeId сохраняется viewport capture.
- Не выдавать неполный envelope arbitrary React/portals/filter за полное оформление.
  Визуальные ограничения должны давать явную диагностику.

## Порядок

1. [x] Canonical Stroke/schema/ADR, legacy suppression, closed/finite/bounded parsing,
       atomic rollback/Undo/reopen tests (worker stroke_contract).
2. [x] Pure local stroke/shadow envelopes и affine projection, independent math tests
       (worker paint_bounds). Shadow crop ещё требует actual Chromium/native pixel QA.
3. [x] Ring descriptor: rounded geometry, inside/center/outside, wide stroke, blend/alpha,
       safe SVG IDs; compose fills/strokes without runtime cycles (worker stroke_renderer/root).
4. [x] Preview/handoff shared composition; separate own clip children from own decoration;
       asset barriers/used/delete/ZIP, document layers/bounds unchanged. Actual pixels.
5. [x] Inspector controlled draft + explicit legacy conversion, order/enable/paint/width/align;
       raw conflict survives, one Apply/Undo. RU/EN/light/dark/keyboard.
6. [x] Compatible capture API/IPC/MCP and visual measurement contract; rasterlimits,
       outward rounding, no viewport/media query change. New UI PNG control defaultsvisual.
7. [ ] Service/native/handoff pixel parity, proposal, old API compatibility, full gates and PR.

Не закрывать #10: masks и расширенные text/vector paints остаются после этой вертикали.
Никаких релизов/тегов или закрытия ручных gates.

Продолжение 2026-10-31: пользователь выбрал два состава PNG. Новый UI по умолчанию
isolated/visual; прежние API — scene/layout. Реализованы чистые bounds/helpers,
DOM измерение/изоляция, service/native wiring, metadata, scoped image/font readiness,
отмена/preview/download в UI. Целевые service pixels и browser UI/DOM прошли.
Полный финальный профиль, packaged native и независимый review обязательны до PR.


Проверки 2026-11-01: typecheck/build; unit819passed/6skip; browser123passed/8skip,
включая настоящий UI→service PNG и скачивание; accessibility13, external1, demo2,
release tooling7. Исправлены и проверены tsx/keepNames factory closure, независимые
CSS rotate/scale, SVGMatrix/3D диагностика, escaping absolute content и внешние
pseudo-elements. Pixel fixture проверяет blur shadow alpha/envelope и оба режима.
Fresh packaged MacARM: signature verify +4native tests passed, включая настоящий
MCP и RGBA PNG. Clean MCP smoke и performance budgets passed (failures=[]).
Локальные обязательные gates завершены; PR и cross-platform CI — следующий шаг.
