# #9: принятый путь и следующая вертикаль

Решение пользователя 2026-10-20: полные affine-преобразования, отдельные Resize
и Scale, без автоматической перезаписи старых проектов. Это план, не описание
уже реализованной функции. Предыдущая рекомендация ограниченной модели отменена.

## Предлагаемый контракт

- Optional `scene.linearTransform: [a,b,c,d]`; x/y остаются единственным переносом.
  Полная матрица `[a,b,c,d,x,y]`, origin — верхний левый угол.
- `linearTransform` и legacy `rotation` взаимоисключающие. Untouched legacy
  nodes не получают новых полей. width/height — локальный layout box, не world AABB.
- Отрицательный determinant допустим (reflection); singular/nonfinite и численно
  неустойчивые преобразования отклоняются до записи. Пределы проверяются на
  независимых примерах, не применяются ретроспективно к нетронутым legacy nodes.
- `setNodeGeometry` заменяет только x/y/width/height и выбранную форму преобразования,
  удаляет альтернативную форму, сохраняет paint/text/path/kind и стабильные ID.
  Старый setNodeMetadata также сохраняет валидацию и защиту locked descendants.
- Optional расширение текущей schemaVersion 2 согласуется с fonts/fills; старый
  strict reader может отвергнуть новые поля. Parser, schema, ADR и capabilities
  должны описывать это явно. Никакой молчаливой деградации до rotation.

## Resize и Scale

Пусть P — world transform родителя, W — world transform выбранного корня,
A — общее мировое преобразование вокруг pivot.

**Scale:** `Mnew = inverse(P) · A · W`. Размеры layout box, fontSize, path, stroke,
radius и локальные дети не переписываются: масштабируется всё содержимое wrapper.

**Single Resize:** меняет width/height, сохраняет линейную часть L; перенос
компенсирует неподвижный anchor: `tNew = tOld + L · (anchorOld − anchorNew)`.
Текст переносится в новом box; локальная геометрия детей сохраняется.

**Multi Resize:** target quad точно следует общему A, положительный масштаб
поглощается layout box. Для `Wt=A·W`, `qx=|col1(Wt)|/|col1(W)|`,
`qy=|col2(Wt)|/|col2(W)|`: `widthNew=width·qx`, `heightNew=height·qy`,
`Mnew=inverse(P)·Wt·diag(1/qx,1/qy,1)`. Остаточный shear сохраняется и явно
показывается инспектором. Это даёт точные углы и reflow, в отличие от Scale.
Cross-zero handle ограничивается положительным минимумом; flip — явное действие.

## Порядок реализации

1. RED core/store: legacy roundtrip, независимые ожидаемые углы nested affine,
   reflection, устойчивость inverse, locks/parent+child, atomic rollback,
   conflict/idempotence/Undo/reopen. Затем модель, операция, parser/schema/ADR.
2. Общий layerStyle → CSS matrix, Preview и handoff. Model quad/AABB, inverse
   hit testing/clipping; renderer/service/agent capture одинаково понимают формат.
3. Числовой inspector: различает layout size, world bounds и derived rotation/
   scale/shear; не округляет документ через постоянную decomposition.
4. Pointer gestures: transient geometry whitelist, source/origin/revision/epoch,
   один commit на pointerup; cancel/stale/blur/dirty не пишут документ.
5. Snapping, rulers/guides и оставшиеся исходные критерии #9. До этого #9 открыта.

## Приёмка

- Старые файлы после открытия/закрытия не переписаны; unrelated batch не добавляет matrix.
- Разные affine-родители, multi selection, shear/reflection: все четыре угла точны;
  parent+child не преобразуются дважды, locked ancestor/descendant защищены.
- Resize меняет wrapping, Scale сохраняет layout sizes и масштабирует содержимое;
  definitions/instances не detach и не rasterize.
- Невалидная последняя операция отклоняет весь batch; один gesture → revision/Undo.
- Поздние geometry/pick сообщения, locale/view change и внешний edit отменяют жест.
- Реальные browser/demo/packaged проверки, обе темы и RU/EN, service/handoff pixels,
  clipboard/clone/detach/undo/reopen. Portals вне wrapper диагностируются как предел.

Источники: read-only разбор analyst-requirements текущих scene.ts,
geometry-commands.ts, operations.ts, handoff.ts, Preview/CanvasSurface и service
schemas/capabilities. Код affine пока не изменён; тесты этого плана не запускались.
